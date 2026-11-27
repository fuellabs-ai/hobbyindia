import React, { useEffect, useRef, useState } from 'react';
import Flow, { flowByCard } from './Flow';
import Feedback from './Feedback';
import { AlertTriangle, ArrowUpRight, Phone } from 'lucide-react';
import './search.css';
import { cardById, emergencyContacts, safeUrl } from './search';

export const DISCLAIMER = 'Independent guide by Fuel Labs. Not a government website.';
// A guide counts only with two named reviewers and an unexpired review date.
const today = new Date().toISOString().slice(0, 10);
const guides = Object.fromEntries(Object.values(import.meta.glob('../data/guides/*.json', { eager: true, import: 'default' }))
  .filter(g => (g.reviewed_by || []).filter(r => r.trim()).length >= 2 && g.next_review >= today).map(g => [g.card_id, g]));
const host = url => { try { return new URL(url).host; } catch { return url; } };

function Emergency() {
  return <section className="emergency" aria-label="Emergency help">
    <AlertTriangle size={22} aria-hidden="true"/>
    <div>
      <h3>If you are in danger or a crime is happening, get help now</h3>
      <ul>{emergencyContacts.map(c => <li key={c.label}>
        <a href={c.href} {...(c.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{c.href.startsWith('tel:') && <Phone size={15} aria-hidden="true"/>}{c.action}</a>
        <span>{c.label}</span>
      </li>)}</ul>
    </div>
  </section>;
}

function Card({ card, primary, onGuide }) {
  return <article className={`result-card ${primary ? 'primary' : ''}`}>
    <div className="result-meta"><span className="coverage">{guides[card.id] ? 'Reviewed guide' : 'Official route only'}</span><span>{card.scope}</span></div>
    <h4>{card.title}</h4>
    <p>{card.summary}</p>
    <a className="official-link" href={safeUrl(card.official_url)} target="_blank" rel="noopener noreferrer">{card.official_name}<span className="host">{host(card.official_url)}</span><ArrowUpRight size={16}/><span className="sr-only"> (official site, opens in a new tab)</span></a>
    {onGuide && flowByCard[card.id] && <button className="guide-button" onClick={() => onGuide(card.id)}>Guide me step by step</button>}
    <p className="card-disclaimer">{DISCLAIMER}</p>
  </article>;
}

// The citizen chooses: the best match opens as a guided flow (or a card), the others stay one tap away.
function Chosen({ id, others, onPick }) {
  const card = cardById[id];
  const flow = flowByCard[id];
  return <div className="chosen">
    <div className="chosen-head"><h4>{card.title}</h4><span>{card.scope}</span></div>
    {flow ? <Flow flow={flow}/> : <Card card={card} primary/>}
    {flow && <p className="card-disclaimer">{DISCLAIMER}</p>}
    {others.length > 0 && <div className="not-this"><span>Not this?</span>{others.map(o => <button key={o} onClick={() => onPick(o)}>{cardById[o].title}</button>)}</div>}
  </div>;
}

export default function SearchResults({ search, onClear }) {
  const heading = useRef(null);
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [search?.question, search?.status]);
  useEffect(() => { if (search?.status === 'done') heading.current?.focus(); }, [search?.status, search?.question]);
  if (!search) return null;
  const { question, status, data } = search;
  return <section id="search-results" className="search-results" aria-live="polite" aria-busy={status === 'working'}>
    <p className="turn-question">{question}</p>
    {status === 'working' && <p className="search-status">Finding the closest services…</p>}
    {status === 'done' && <>
      {data.emergency && <Emergency/>}
      {search.waking && <p className="waking" role="status">Smart search is starting, about a minute. These are quick keyword results; they’ll update when it’s ready.</p>}
      {search.upgraded && <p className="waking done" role="status">Updated with HobbyLM-Embed smart search.</p>}
      {data.reason === 'script_unsupported' ? <>
        <h3 ref={heading} tabIndex={-1} className="search-heading">Please type in English letters</h3>
        <p className="search-note">We can’t read Hindi, Tamil or Kannada script yet. Try typing the same question in English letters, for example “ration card kaise banaye” or “aadhaar la per thappa irukku”.</p>
      </> : <>
      <h3 ref={heading} tabIndex={-1} className="search-heading">{picked || data.covered ? 'Your next step' : data.ambiguous ? 'Which of these fits?' : 'Not covered yet'}</h3>
      {!picked && data.ambiguous && !data.covered && <p className="search-note">More than one service matches. Pick the one that fits your situation.</p>}
      {!picked && !data.covered && !data.ambiguous && <p className="search-note">We don’t have a card for this question yet. These are the closest services we do cover. They may not fit your situation.</p>}
      {(() => {
        const ids = data.results.map(r => r.id);
        const chosen = picked || (data.covered ? ids[0] : null);
        if (chosen) return <><Chosen id={chosen} others={ids.filter(i => i !== chosen)} onPick={setPicked}/><Feedback key={chosen + search.question} cardId={chosen} privateMode={data.source === 'private'}/></>;
        return <><div className="result-list">{ids.map(i => <Card key={i} card={cardById[i]} onGuide={setPicked}/>)}</div>{ids[0] && <Feedback key={ids[0] + search.question} cardId={ids[0]} privateMode={data.source === 'private'}/>}</>;
      })()}
      </>}
      <p className="search-source">
        {data.source === 'private' ? 'Matched on your computer with HobbyLM-Embed (private mode).' : data.source === 'embedding' ? 'Matched with HobbyLM-Embed.' : data.source === 'local' ? '' : `Matched with keyword search because the search service was ${data.fallbackReason === 'timeout' ? 'slow' : 'unavailable'}.`}{' '}
        Results come from fixed cards written by the project team. Nothing here is generated, and the official service decides your case.
      </p>
      <button className="secondary-action" onClick={onClear}>Ask another question</button>
    </>}
  </section>;
}
