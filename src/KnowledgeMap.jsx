import React, { useEffect, useMemo, useRef, useState } from 'react';
import './knowledge.css';
import knowledge from '../data/knowledge.json';
import passageData from '../data/sources/passages.json';
import { cardById, safeUrl } from './search';
import { flowByCard } from './Flow';

// Mind map in the "text on coloured underlines" style: each area is its own coloured branch,
// curves join the end of one underline to the start of the next, leaves are plain sentences.
// A matched service draws its branch in full colour, hop by hop; the rest fades back.
// Light-mode categorical palette (dataviz skill): validated on #eef1f0; every line carries a dark text label.
const COLORS = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'];
const AREA_COLOR = Object.fromEntries(knowledge.areas.map((a, i) => [a.id, COLORS[i]]));
const host = url => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };
const passageCount = Object.fromEntries(Object.keys(cardById).map(id => [id, passageData.passages.filter(p => p.cards.includes(id)).length]));
export const areaOf = Object.fromEntries(knowledge.areas.flatMap(a => a.departments.flatMap((d, j) => d.cards.map(c => [c, { area: a.id, dept: `${a.id}:${j}` }]))));

export function pathNames(cardId) {
  const a = areaOf[cardId]; if (!a) return [];
  const area = knowledge.areas.find(x => x.id === a.area);
  return [area.name, area.departments[Number(a.dept.split(':')[1])].name, cardById[cardId].title];
}

const FONT = '14px Montserrat, Arial, sans-serif', LINE = 24, GAP_X = 48, GAP_Y = 24, LEAF_W = 250, PAD = 18;
let ctx;
const measure = (text, font = FONT) => { ctx ??= document.createElement('canvas').getContext('2d'); ctx.font = font; return ctx.measureText(text).width; };
function wrap(text, max) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (cur && measure(t) > max) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

function authorityOf(cardId) {
  // Only when the flow belongs to this one service: shared flows (RTI, certificates) have different
  // authorities per branch, and the map must never name the wrong one.
  const f = flowByCard[cardId]; if (!f || f.cards.length !== 1) return null;
  const step = Object.values(f.nodes).find(n => n.step && n.authority);
  return step?.authority;
}

function buildTree(open, active) {
  return { id: 'root', text: 'HobbyIndia', root: true, children: knowledge.areas.map(a => ({
    id: a.id, area: a.id, text: `${a.name}${open.has(a.id) ? '' : `  ·  ${a.departments.reduce((n, d) => n + d.cards.length, 0)}`}`, toggle: true,
    children: !open.has(a.id) ? [] : a.departments.map((d, j) => ({ id: `${a.id}:${j}`, area: a.id, text: d.name,
      children: d.cards.map(c => {
        const card = cardById[c];
        const node = { id: c, area: a.id, text: card.title, service: true, children: [] };
        if (c === active) {
          const auth = authorityOf(c);
          node.children = [
            { id: `${c}#sum`, area: a.id, text: card.summary, leaf: true },
            auth && { id: `${c}#auth`, area: a.id, text: `Handled by: ${auth}`, leaf: true },
            { id: `${c}#site`, area: a.id, text: `Go to ${host(card.official_url)} ↗`, leaf: true, url: safeUrl(card.official_url) },
            flowByCard[c] && { id: `${c}#flow`, area: a.id, text: 'Step-by-step guide', leaf: true, open: c },
            passageCount[c] > 0 && { id: `${c}#faq`, area: a.id, text: `${passageCount[c]} official FAQ passages`, leaf: true },
          ].filter(Boolean);
        }
        return node;
      }) })) })) };
}

// Positions: leaves stack top to bottom; a parent sits at the middle of its children; a child starts
// where its parent's underline ends (+ gap), so branches grow to the right like a hand-drawn mind map.
function layout(tree) {
  const nodes = [], edges = []; let y = PAD;
  const visit = (n, x, parent) => {
    const lines = n.leaf ? wrap(n.text, LEAF_W) : [n.text];
    const w = n.root ? measure(n.text, '600 14px Montserrat') + 28 : Math.max(...lines.map(l => measure(l))) + 6;
    const h = lines.length * LINE;
    let base;
    if (n.children?.length) {
      const ys = n.children.map(c => visit(c, x + w + GAP_X, n));
      base = (Math.min(...ys) + Math.max(...ys)) / 2;
    } else { base = y + h; y += h + GAP_Y; }
    nodes.push({ n, x, w, lines, base });
    if (parent) edges.push({ from: parent.id, to: n.id, area: n.area });
    return base;
  };
  visit(tree, PAD, null);
  const byId = Object.fromEntries(nodes.map(p => [p.n.id, p]));
  const width = Math.max(...nodes.map(p => p.x + p.w)) + PAD, height = y + PAD;
  return { nodes, edges: edges.map(e => ({ ...e, a: byId[e.from], b: byId[e.to] })), width, height };
}

export default function KnowledgeMap({ activeId, previewId, onOpen, title = 'Where this sits in India’s services', intro }) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [open, setOpen] = useState(() => new Set(activeId ? [areaOf[activeId]?.area] : []));
  const [runKey, setRunKey] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);
  useEffect(() => { if (activeId && areaOf[activeId]) { setOpen(new Set([areaOf[activeId].area])); setRunKey(k => k + 1); } }, [activeId]);
  useEffect(() => { if (previewId && !activeId && areaOf[previewId]) setOpen(new Set([areaOf[previewId].area])); }, [previewId]);
  useEffect(() => {
    const ob = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (wrapRef.current) ob.observe(wrapRef.current);
    return () => ob.disconnect();
  }, []);

  const focus = activeId || previewId;
  const path = focus && areaOf[focus] ? ['root', areaOf[focus].area, areaOf[focus].dept, focus] : [];
  const tree = buildTree(open, activeId);
  const lay = useMemo(() => layout(tree), [open, activeId, fontsReady]);
  const leafIds = lay.nodes.filter(p => p.n.leaf).map(p => p.n.id);
  const order = activeId ? [...path, ...leafIds] : [];
  const delay = id => Math.max(0, order.indexOf(id)) * (reduce ? 0 : .32);
  const lit = id => order.includes(id) || (!activeId && path.includes(id));
  const fade = id => Boolean(focus) && !lit(id);
  const compact = width < 720;
  const toggle = id => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const act = n => n.toggle ? () => toggle(n.id) : n.service ? () => onOpen?.(n.id) : n.open ? () => onOpen?.(n.open) : null;

  return <section className="km" aria-label={title}>
    <div className="km-head">{intro ? <h2>{title}</h2> : <h3>{title}</h3>}{intro && <p>{intro}</p>}<p className="km-hint">Tap an area to expand · tap a service to open its guide</p>{knowledge.checked === false && <small>Department map drafted by Fuel Labs; being checked.</small>}</div>
    <div className="km-canvas" ref={wrapRef}>
      {compact ? <ul className="km-list" key={runKey}>
        {(() => { const rows = []; const walk = (n, d) => { rows.push({ n, d }); (n.children || []).forEach(c => walk(c, d + 1)); }; walk(tree, 0); return rows; })().map(({ n, d }) => {
          const f = act(n);
          const inner = n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.text}</a> : f ? <button onClick={f} aria-expanded={n.toggle ? open.has(n.id) : undefined}>{n.text}<span className="km-affordance" aria-hidden="true">{n.toggle ? (open.has(n.id) ? '−' : '+') : '↗'}</span></button> : <span>{n.text}</span>;
          return <li key={n.id} className={`${lit(n.id) ? 'lit' : ''} ${fade(n.id) ? 'fade' : ''} ${n.root ? 'root' : ''} ${n.leaf ? 'leaf' : ''}`} style={{ '--d': d, '--c': AREA_COLOR[n.area] || '#11110f', '--delay': `${delay(n.id)}s` }}>{inner}</li>;
        })}
      </ul> : <div className="km-scroll"><svg key={runKey} width={lay.width} height={lay.height} className="km-svg" role="group" aria-label={title}>
        {lay.edges.map(e => {
          const x1 = e.a.x + e.a.w, y1 = e.a.base, x2 = e.b.x, y2 = e.b.base, m = (x2 - x1) * .55;
          return <path key={`${e.from}>${e.to}`} d={`M${x1} ${y1} C${x1 + m} ${y1} ${x2 - m} ${y2} ${x2} ${y2}`} stroke={AREA_COLOR[e.area]} pathLength="1"
            className={`km-edge ${lit(e.to) ? 'lit' : ''} ${fade(e.to) ? 'fade' : ''} ${activeId && lit(e.to) ? 'draw' : ''} ${!activeId && lit(e.to) ? 'scan' : ''}`} style={{ '--delay': `${delay(e.to)}s` }}/>;
        })}
        {lay.nodes.map(({ n, x, w, lines, base }) => {
          const f = act(n);
          const cls = `km-node ${lit(n.id) ? 'lit' : ''} ${fade(n.id) ? 'fade' : ''} ${n.leaf ? 'leaf' : ''} ${f || n.url ? 'clickable' : ''}`;
          if (n.root) return <g key={n.id} className={cls}><rect x={x} y={base - 17} width={w} height={34} rx={8} className="km-root"/><text x={x + 14} y={base + 5} className="km-root-text">{n.text}</text></g>;
          const text = <text x={x + 2} y={base - 6 - (lines.length - 1) * LINE}>{lines.map((l, i) => <tspan key={i} x={x + 2} dy={i ? LINE : 0}>{l}</tspan>)}</text>;
          const line = <line x1={x} y1={base} x2={x + w} y2={base} stroke={AREA_COLOR[n.area]} pathLength="1" className={`km-under ${activeId && lit(n.id) ? 'draw' : ''}`} style={{ '--delay': `${delay(n.id) + .12}s` }}/>;
          const body = <g className={cls} style={{ '--delay': `${delay(n.id)}s` }}>{text}{line}</g>;
          if (n.url) return <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer">{body}</a>;
          if (f) return <g key={n.id} role="button" tabIndex={0} aria-label={`${n.text}: ${n.toggle ? 'expand or collapse area' : 'open guide'}`} aria-expanded={n.toggle ? open.has(n.id) : undefined} onClick={f} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), f())}><title>{n.toggle ? 'Tap to expand or collapse' : 'Tap to open guide'}</title>{body}</g>;
          return <g key={n.id}><title>{n.toggle ? 'Tap to expand or collapse' : 'Tap to open guide'}</title>{body}</g>;
        })}
      </svg></div>}
    </div>
  </section>;
}
