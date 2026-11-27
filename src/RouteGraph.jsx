import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Laptop, Server, ShieldAlert, ShieldCheck } from 'lucide-react';
import './route.css';
import { cardById, normalize, redact } from './search';
import passageData from '../data/sources/passages.json';

const passageById = Object.fromEntries(passageData.passages.map(p => [p.id, p]));
const host = url => { try { return new URL(url).host; } catch { return url; } };
const fmt = s => (typeof s === 'number' ? s.toFixed(2) : '');

// Live route graph: the real path one question took. Every value shown comes from the search result
// (docs/search-contract.md); nothing is decorative. Collapsed by default; animates once when opened.
export default function RouteGraph({ question, data, chosenId, flowTrail = [], onPick, handoff }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const canvas = useRef(null);
  // Follow the pulse: scroll along as each node appears (wide graphs on desktop).
  useEffect(() => {
    if (!open || !canvas.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = canvas.current; const steps = 10; let k = 0;
    const t = setInterval(() => { k++; el.scrollTo({ left: (el.scrollWidth - el.clientWidth) * Math.min(1, k / steps) }); if (k >= steps) clearInterval(t); }, 260);
    return () => clearInterval(t);
  }, [open]);
  const [text, removed] = useMemo(() => redact(question), [question]);
  const cleaned = data.cleaned ?? normalize(text);
  const removedData = data.removed_personal_data ?? removed;
  const where = data.source === 'private' ? 'On your computer · 0 requests sent' : data.source === 'embedding' ? 'On our search server' : data.source === 'keyword' ? 'Keyword search in your browser' : 'In your browser';
  const ms = data.timing_ms?.total ?? data.ms;
  const compared = data.compared ?? (data.source === 'keyword' ? Object.keys(cardById).length : 144);
  const isModel = data.source === 'embedding' || data.source === 'private';
  const passages = (data.passages || []).filter(p => passageById[p.id]);
  const shownPassage = passages.find(p => p.score >= (data.passage_threshold ?? 0));

  const nodes = [
    { id: 'words', title: 'Your words', body: `“${question}”` },
    { id: 'cleaned', title: 'Cleaned', body: `“${cleaned || '—'}”`, note: removedData ? 'Personal numbers removed' : 'Hinglish / Tanglish / Kanglish → English' },
    { id: 'safety', title: 'Safety check', body: data.emergency ? 'Emergency words found → 112 and 1930 shown first' : 'No emergency words', tone: data.emergency ? 'alert' : 'ok' },
    { id: 'model', title: isModel ? 'HobbyLM-Embed' : 'Keyword match', body: isModel ? `Question → 512 numbers, compared with ${compared} saved examples` : `Matched words against ${compared} cards`, note: `${where}${ms != null ? ` · ${ms} ms` : ''}`, icon: data.source === 'private' ? Laptop : Server },
  ];

  if (data.source === 'browse' || data.reason === 'script_unsupported' || !data.results?.length) return null;

  return <section className={`route ${open ? 'open' : ''}`}>
    <button className="route-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}><ChevronDown size={16} aria-hidden="true"/>{open ? 'Hide how we found this' : 'See how we found this'}</button>
    {open && <div ref={canvas} className="route-canvas" role="list" aria-label="How your question was matched">
      {nodes.map((n, i) => <React.Fragment key={n.id}>
        <Node n={n} i={i} active={detail === n.id} onClick={() => setDetail(d => d === n.id ? null : n.id)}/>
        <Wire i={i}/>
      </React.Fragment>)}
      <div className="route-fan" role="listitem" style={{ '--i': 4 }}>
        <span className="route-label">Closest services{data.threshold ? ` · show if ≥ ${fmt(data.threshold)}` : ''}</span>
        {data.results.map(r => {
          const c = cardById[r.id]; const win = r.id === chosenId;
          return <button key={r.id} className={`route-node candidate ${win ? 'win' : 'dim'}`} onClick={() => !win && onPick?.(r.id)} aria-pressed={win} title={win ? 'Shown' : 'Show this one instead'}>
            <b>{c?.title}</b>
            <span className="route-score">{data.source === 'keyword' ? `${fmt(r.score)} pts` : fmt(r.score)}</span>
            {r.matched && <small>matched “{r.matched}”</small>}
            {!win && <small className="route-switch">Tap to show this instead</small>}
          </button>;
        })}
        <span className="route-verdict">{data.covered ? `${fmt(data.results[0].score)} passed the bar → shown as your match` : data.ambiguous ? 'Too close to call → you choose' : 'Below the bar → “Not covered yet”'}</span>
      </div>
      {flowTrail.map((t, k) => <React.Fragment key={k}>
        <Wire i={5 + k}/>
        <div className="route-node choice" role="listitem" style={{ '--i': 5 + k }}>
          <span className="route-label">Your choice</span>
          <b>{t.ask}</b>
          <span className="route-chosen">→ {t.chosen}</span>
          {t.others.length > 0 && <small>Other options: {t.others.join(' · ')}</small>}
        </div>
      </React.Fragment>)}
      {shownPassage && <>
        <Wire i={5 + flowTrail.length}/>
        <div className="route-node passage" role="listitem" style={{ '--i': 6 + flowTrail.length }}>
          <span className="route-label">Official source · {passages.length} of {data.passages_compared ?? '?'} passages ranked</span>
          <b>{passageById[shownPassage.id].source}</b>
          <span className="route-score">{fmt(shownPassage.score)}</span>
          <small>“{passageById[shownPassage.id].question}”</small>
        </div>
      </>}
      {handoff && <>
        <Wire i={6 + flowTrail.length}/>
        <a className="route-node handoff" role="listitem" style={{ '--i': 7 + flowTrail.length }} href={handoff.url} target="_blank" rel="noopener noreferrer">
          <span className="route-label">Handed to</span>
          <b>{host(handoff.url)} ↗</b>
          <small>{handoff.authority || handoff.label}. You continue there.</small>
        </a>
      </>}
    </div>}
  </section>;
}

function Node({ n, i, active, onClick }) {
  const Icon = n.tone === 'alert' ? ShieldAlert : n.tone === 'ok' ? ShieldCheck : n.icon;
  return <button className={`route-node ${n.tone || ''} ${active ? 'active' : ''}`} role="listitem" style={{ '--i': i }} onClick={onClick} aria-expanded={active}>
    <span className="route-label">{Icon && <Icon size={13} aria-hidden="true"/>}{n.title}</span>
    <b>{n.body}</b>
    {n.note && <small>{n.note}</small>}
  </button>;
}

const Wire = ({ i }) => <span className="route-wire" aria-hidden="true" style={{ '--i': i + 0.5 }}/>;
