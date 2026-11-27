import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { matchScenario, wordGroups } from './scenarioMatch';

// A holographic file-tree replay of where the answer really came from.
// The tree mirrors the local backend store. The lit path is the file the server
// actually reads for this request (server.py / experiment.py); the hit file then
// expands into the fields this page received from it. Nothing else is "searched".

const OUTCOME_LABEL = { rti: 'RTI · no reply', scenario: 'CPGRAMS · closed', which_case: 'ask which case', details: 'closure details', state: 'State / UT', not_covered: 'no prepared scenario' };
const STOP = new Set(['the', 'and', 'but', 'how', 'does', 'what', 'with', 'that', 'this', 'from', 'have', 'been', 'your', 'my', 'is', 'it', 'to', 'an', 'a', 'of', 'in', 'on', 'for', 'was', 'are', 'can', 'its']);
// About five seconds end to end: four hops, then the file's fields one by one.
const STEP = .95, FIELD_STEP = .3;
const host = url => { try { return new URL(url).host; } catch { return url; } };
const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

// backend/ as it exists on disk (backend/data and backend/corpus, 15 Oct 2026).
function storeTree() {
  return { id: 'backend', name: 'backend/', dir: true, children: [
    { id: 'data', name: 'data/', dir: true, children: [
      { id: 'demo', name: 'scenarios/', dir: true, children: [
        { id: 'cpgrams', name: 'cpgrams-decision-concept.json' },
        { id: 'rti', name: 'rti-decision-concept.json', logo: '/logos/rti.svg' },
      ] },
      { id: 'services', name: 'services.json' },
      { id: 'routing', name: 'routing.jsonl' },
      { id: 'queue', name: 'source-queue.json' },
    ] },
    { id: 'corpus', name: 'corpus/', dir: true, children: [
      { id: 'faq', name: 'cpgrams-faq/0e23…/', dir: true, children: [
        { id: 'manifest', name: 'manifest.json' },
        { id: 'chunks', name: 'chunks.jsonl' },
        { id: 'text', name: 'text.txt' },
        { id: 'html', name: 'source.html' },
      ] },
    ] },
  ] };
}

export default function StoreTrace({ turn, selected, onSelect, onReveal }) {
  const authored = turn.mode === 'authored';
  const done = turn.status === 'done';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = useRef(null), nodeRefs = useRef({});
  const [width, setWidth] = useState(900);
  const [widths, setWidths] = useState({});
  const [arrived, setArrived] = useState(false);
  const compact = width < 680;

  // What really happened
  const outcome = authored ? matchScenario(turn.question) : null;
  const call = turn.call;
  const words = (turn.question.match(/[A-Za-z0-9][A-Za-z0-9'’/-]*/g) || []);
  const passageWords = new Set((turn.result?.sources || []).flatMap(source => (source.text || '').toLowerCase().match(/[a-z0-9]+/g) || []));
  const keyed = [...new Set(words.filter(word => authored ? wordGroups(word).length : (word.length > 3 && !STOP.has(word.toLowerCase()) && passageWords.has(word.toLowerCase()))))].slice(0, 5);
  const hitId = authored ? (turn.kind === 'scenario' && call ? (call.path.endsWith('/rti') ? 'rti' : 'cpgrams') : null) : (turn.kind === 'live' ? 'chunks' : null);
  const readIds = !authored && turn.kind === 'live' ? ['manifest', 'text'] : [];
  const pathIds = hitId === 'chunks' ? ['backend', 'corpus', 'faq', 'chunks'] : hitId ? ['backend', 'data', 'demo', hitId] : [];
  const pending = turn.status === 'working';
  const pendingPath = pending ? (authored ? ['backend', 'data', 'demo'] : ['backend', 'corpus', 'faq']) : [];

  // Fields this page received from the hit file
  const scenario = turn.scenario, result = turn.result, src = authored ? scenario?.sources?.[0] : result?.sources?.[0];
  const fields = hitId && done ? (authored
    ? [{ k: 'title', v: cut(scenario.title, 30), answer: true }, { k: 'choices', v: `${scenario.choices.length} branches` }, { k: 'sources', v: `${host(src?.url || '')} · ${(src?.status || 'draft').split(/[\s;,]/)[0]}`, source: 0 }]
    : [{ k: 'passage', v: cut(src?.locator || 'saved passage', 28), source: 0 }, { k: 'review', v: (src?.approval || 'draft').split(/[\s;,]/)[0] }, { k: 'hobbylm-1b', v: `${result.usage?.output_tokens ?? 0} tokens`, answer: true }]) : [];

  // Build the visible tree with fields attached to the hit file
  const tree = storeTree();
  const attach = node => { if (node.id === hitId) node.children = fields.map((f, i) => ({ id: `f${i}`, name: f.v, field: f })); (node.children || []).forEach(attach); };
  attach(tree);

  // Sequence: each hop along the real path lights in turn
  const order = [...pathIds, ...fields.map((_, i) => `f${i}`)];
  const delayOf = id => { const i = order.indexOf(id); return i < 0 ? 0 : i < pathIds.length ? i * STEP : pathIds.length * STEP + (i - pathIds.length) * FIELD_STEP; };
  const total = pathIds.length * STEP + fields.length * FIELD_STEP + .5;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (wrap.current) observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!done && turn.status !== 'error') return;
    // Reveal when the signal reaches the hit file's fields; questions with no file hit settle quickly.
    const wait = reduce || turn.status === 'error' ? 0 : hitId ? total * 1000 : 600;
    const timer = setTimeout(() => { setArrived(true); onReveal?.(); }, wait);
    return () => clearTimeout(timer);
  }, [done, turn.status, hitId]);

  // Layout: leaves take consecutive rows; parents sit at the middle of their children.
  const rowH = compact ? 30 : 34, cols = compact ? null : [0, 0, .14, .28, .5, .76];
  const placed = []; const edges = []; let row = 0;
  const place = (node, depth, parent) => {
    let y;
    if (node.children?.length) { const ys = node.children.map(child => place(child, depth + 1, node)); y = compact ? null : (Math.min(...ys) + Math.max(...ys)) / 2; }
    else y = row++ * rowH;
    placed.push({ node, depth, y, parent });
    return y;
  };
  if (!compact) place(tree, 1, null);
  const height = compact ? 0 : row * rowH + 40;
  const xOf = depth => 18 + cols[depth] * (width - 36);

  // Compact: indented explorer list
  const list = [];
  const walk = (node, depth) => { list.push({ node, depth }); (node.children || []).forEach(child => walk(child, depth + 1)); };
  if (compact) walk(tree, 0);

  useLayoutEffect(() => {
    const next = {};
    for (const [id, el] of Object.entries(nodeRefs.current)) if (el) next[id] = el.offsetWidth;
    if (JSON.stringify(next) !== JSON.stringify(widths)) setWidths(next);
  });

  const state = id => pathIds.includes(id) || order.includes(id) ? 'hit' : readIds.includes(id) ? 'read' : pendingPath.includes(id) ? 'scan' : 'idle';
  const icon = node => node.field ? null
    : node.dir ? <svg className="tree-icon folder" viewBox="0 0 16 13" aria-hidden="true"><path d="M1 2.2C1 1.5 1.5 1 2.2 1h3.6l1.6 1.8h6.4c.7 0 1.2.5 1.2 1.2v6.8c0 .7-.5 1.2-1.2 1.2H2.2c-.7 0-1.2-.5-1.2-1.2z"/></svg>
    : node.logo && hitId === node.id ? <img className="tree-icon logo" src={node.logo} alt="" />
    : <svg className="tree-icon file" viewBox="0 0 12 15" aria-hidden="true"><path d="M1.5 1h6l3 3v9.5c0 .3-.2.5-.5.5H1.5c-.3 0-.5-.2-.5-.5V1.5c0-.3.2-.5.5-.5z"/><path d="M7.5 1v3h3"/></svg>;
  const label = node => node.field ? <><span className="field-key">{node.field.k}</span>{node.field.source !== undefined ? <button className={`field-value link ${selected === node.field.source ? 'on' : ''}`} aria-expanded={selected === node.field.source} onClick={() => onSelect(selected === node.field.source ? null : node.field.source)}>{node.name}</button> : <span className="field-value">{node.name}</span>}</> : <span>{node.name}</span>;

  const requestLabel = call ? `${call.method} ${call.path} · ${call.status} · ${call.ms < 1000 ? `${call.ms} ms` : `${(call.ms / 1000).toFixed(1)} s`}` : pending ? (authored ? 'GET /v1/scenarios/…' : 'POST /v1/experiments/generate …') : authored ? 'no request' : '';
  const matchLabel = authored ? OUTCOME_LABEL[outcome] : turn.kind === 'live_refused' ? 'declined before retrieval' : '';

  return <div className={`store ${authored ? '' : 'live'} ${reduce ? 'still' : ''}`} ref={wrap}>
    <span className="store-sparkle s1" aria-hidden="true"/><span className="store-sparkle s2" aria-hidden="true"/><span className="store-sparkle s3" aria-hidden="true"/>
    <div className="store-head">
      <div className={`store-question ${pending ? 'pending' : ''}`}>
        <span>Your question</span>
        <div className="keyed">{keyed.length ? keyed.map(word => <em key={word}>{word}</em>) : <i>no keywords matched</i>}</div>
      </div>
      <div className="store-call">
        {matchLabel && <span className={`match ${hitId || outcome === 'which_case' ? '' : 'dead'}`}>{authored ? 'matched · ' : ''}{matchLabel}</span>}
        {requestLabel && <code className={pending ? 'pending' : ''}>{requestLabel}</code>}
      </div>
    </div>

    {compact ? <ul className="store-list" aria-label="Local store">
      {list.map(({ node, depth }) => <li key={node.id} className={`tree-row ${state(node.id)}`} style={{ '--depth': depth, '--delay': `${delayOf(node.id)}s` }}>
        {icon(node)}{label(node)}
      </li>)}
    </ul> : <div className="store-map" style={{ height }} role="group" aria-label="Local store">
      <svg width={width} height={height} aria-hidden="true">
        {placed.filter(p => p.parent).map(({ node, depth, y, parent }) => {
          const py = placed.find(p => p.node === parent).y + 20, cy = y + 20;
          const x1 = xOf(depth - 1) + (widths[parent.id] || 80) + 4, x2 = xOf(depth) - 4, mx = (x1 + x2) / 2;
          return <path key={node.id} className={`tree-edge ${state(node.id)}`} style={{ '--delay': `${delayOf(node.id)}s` }} d={`M${x1} ${py} C${mx} ${py} ${mx} ${cy} ${x2} ${cy}`} pathLength="1"/>;
        })}
      </svg>
      {placed.map(({ node, depth, y }) => <div key={node.id} ref={el => { nodeRefs.current[node.id] = el; }} className={`tree-node ${state(node.id)} ${node.field ? 'field' : ''} ${node.field?.answer ? 'answer' : ''} ${depth === 1 ? 'root' : ''}`} style={{ left: xOf(depth), top: y + 8, '--delay': `${delayOf(node.id)}s` }}>
        {icon(node)}{label(node)}
      </div>)}
    </div>}

    <p className="sr-only">{hitId ? `The server read ${pathIds.map(id => ({ backend: 'backend', data: 'data', demo: 'scenarios', corpus: 'corpus', faq: 'cpgrams-faq/0e238c6c4dc3' }[id] || '')).filter(Boolean).join('/')}/${{ rti: 'rti-decision-concept.json', cpgrams: 'cpgrams-decision-concept.json', chunks: 'chunks.jsonl' }[hitId]}.` : 'No stored file was read for this question.'}</p>
  </div>;
}
