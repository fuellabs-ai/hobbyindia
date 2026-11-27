import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, Pause, Play, Plus, RotateCcw, X as Close } from 'lucide-react';
import './meaning.css';
import mapData from '../data/index/meaning_map.json';
import knowledge from '../data/knowledge.json';
import { cardById, keywordSearch, searchQuestion } from './search';
import { SEARCH_MODE } from './PrivateMode';
import { areaOf } from './KnowledgeMap';

// Validated categorical palette (dataviz skill, dark surface: all checks pass). Fixed order by area.
const COLORS = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'];
const AREA_COLOR = Object.fromEntries(knowledge.areas.map((a, i) => [a.id, COLORS[i]]));
const AREA_NAME = Object.fromEntries(knowledge.areas.map(a => [a.id, a.name]));
const W = 1000, H = 640, PAD = 40;
const X = x => PAD + x * (W - 2 * PAD), Y = y => PAD + y * (H - 2 * PAD);
const pts = mapData.points.map((p, i) => ({ ...p, i, area: areaOf[p.card]?.area, px: X(p.x), py: Y(p.y) }));
const cardPt = Object.fromEntries(pts.filter(p => p.kind === 'card').map(p => [p.card, p]));
const passagePt = Object.fromEntries(pts.filter(p => p.kind === 'passage').map(p => [p.passage, p]));
const examplesOf = Object.fromEntries(Object.keys(cardPt).map(c => [c, pts.filter(p => p.kind === 'example' && p.card === c)]));
const FAQ = Object.entries({ rti: 'RTI Online FAQ', passport: 'Passport FAQ', 'legal-aid': 'NALSA legal aid FAQ' }).map(([d, name]) => {
  const ps = pts.filter(p => p.kind === 'passage' && p.passage.startsWith(d + '-'));
  return { d, name, n: ps.length, x: ps.reduce((s, p) => s + p.px, 0) / ps.length, y: Math.min(...ps.map(p => p.py)) - 14 };
});
// The first two are real test questions where matching words picks the wrong service and meaning picks the right one.
const EXAMPLES = ['aadhaar card mein naam galat hai', 'I applied for an RTI two months back and nobody replied', 'thela lagane ke liye loan chahiye', 'passport police verification pending'];
const FULL = { x: 0, y: 0, w: W, h: H };

// Where to draw the question: among its closest matches (weighted by score). A picture of the
// 512-number space; the search itself compares the full 512 numbers.
function place(results) {
  const ws = results.map(r => ({ p: cardPt[r.id], w: Math.max(r.score ?? 0, 0) ** 18 })).filter(x => x.p); // stays close to the best match
  const t = ws.reduce((s, x) => s + x.w, 0) || 1;
  return { x: ws.reduce((s, x) => s + x.p.px * x.w, 0) / t, y: ws.reduce((s, x) => s + x.p.py * x.w, 0) / t };
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function useViewBox() {
  const [vb, setVb] = useState(FULL);
  const anim = useRef(0);
  const glide = target => {
    cancelAnimationFrame(anim.current);
    if (reduced()) { setVb(target); return; }
    const from = { ...vb }, t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / 650), e = 1 - (1 - k) ** 3;
      setVb({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      if (k < 1) anim.current = requestAnimationFrame(step); };
    anim.current = requestAnimationFrame(step);
  };
  const around = (cx, cy, w) => { const h = w * H / W; return { x: Math.max(-200, Math.min(W - w + 200, cx - w / 2)), y: Math.max(-150, Math.min(H - h + 150, cy - h / 2)), w, h }; };
  return { vb, setVb, glide, around };
}

function Map({ full, state, actions }) {
  const { res, mode, hover, focusArea, selected } = state;
  const { setHover, select } = actions;
  const svgRef = useRef(null), drag = useRef(null);
  const { vb, setVb, glide, around } = state.view;

  const shown = res && (mode === 'meaning' ? res.meaning : res.keyword);
  const top = shown?.results?.filter(r => cardPt[r.id] && (mode === 'keyword' ? r.score > 0 : true)) || [];
  const at = top.length ? place(mode === 'keyword' ? top.map(r => ({ ...r, score: r.score / (top[0].score || 1) })) : top) : null;
  const passages = mode === 'meaning' ? (shown?.passages || []).filter(p => passagePt[p.id]) : [];
  const family = hover ? (hover.kind === 'passage' ? new Set([hover.i]) : new Set([cardPt[hover.card]?.i, ...examplesOf[hover.card].map(p => p.i)])) : null;
  const near = new Set([...top.map(r => cardPt[r.id]?.i), ...passages.map(p => passagePt[p.id]?.i)]);

  useEffect(() => { if (full && at) glide(around(at.x, at.y, 520)); }, [full, res?.q, mode]);
  useEffect(() => { if (full && selected) { const p = cardPt[selected]; glide(around(p.px, p.py, 460)); } }, [full, selected]);

  const toSvg = e => { const r = svgRef.current.getBoundingClientRect(); return { x: vb.x + (e.clientX - r.left) / r.width * vb.w, y: vb.y + (e.clientY - r.top) / r.height * vb.h }; };
  const onWheel = e => { if (!full) return; e.preventDefault(); const p = toSvg(e), k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const w = Math.max(180, Math.min(W * 1.4, vb.w * k)), h = w * H / W;
    setVb({ x: p.x - (p.x - vb.x) * (w / vb.w), y: p.y - (p.y - vb.y) * (h / vb.h), w, h }); };
  useEffect(() => { const el = svgRef.current; if (!el || !full) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); });
  const onDown = e => { if (!full || e.target.closest('[data-dot]')) return; drag.current = { sx: e.clientX, sy: e.clientY, vb }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = e => { const d = drag.current; if (!d) return; const r = svgRef.current.getBoundingClientRect();
    setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.sx) / r.width * d.vb.w, y: d.vb.y - (e.clientY - d.sy) / r.height * d.vb.h }); };
  const onUp = () => { drag.current = null; };
  const [renderWidth, setRenderWidth] = useState(W);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRenderWidth(entry.contentRect.width || W));
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  const textScale = vb.w / renderWidth;
  const scale = vb.w / W; // keep dots and text the same size on screen while zooming

  return <svg ref={svgRef} className={`mm-svg ${full ? 'full' : ''}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="Map of services, example questions and official FAQ passages, arranged by meaning"
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }}>
    <defs>
      <radialGradient id="mm-bg" cx="50%" cy="45%" r="70%"><stop offset="0" stopColor="#1b1e19"/><stop offset="1" stopColor="#0d0e0c"/></radialGradient>
      <filter id="mm-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
    </defs>
    <rect x={-2000} y={-2000} width={W + 4000} height={H + 4000} fill="url(#mm-bg)"/>
    {/* threads: every example question hangs off its service */}
    <g className="mm-threads">{pts.filter(p => p.kind === 'example').map(p => { const c = cardPt[p.card];
      const on = family?.has(p.i) || (selected === p.card);
      if (!on && Math.hypot(p.px - c.px, p.py - c.py) > 150) return null; // long threads only when that service is in focus
      return <line key={p.i} x1={p.px} y1={p.py} x2={c.px} y2={c.py} stroke={AREA_COLOR[p.area]} strokeWidth={(on ? 1.4 : .6) * scale} opacity={on ? .8 : focusArea && p.area !== focusArea ? .03 : .16}/>; })}</g>
    {full && FAQ.map(f => <text key={f.d} className="mm-faq" x={f.x} y={f.y} fontSize={12 * textScale} textAnchor="middle">{f.name} · {f.n}</text>)}
    {at && top.map((r, k) => { const p = cardPt[r.id]; return <line key={`${res.q}${mode}${r.id}`} className={`mm-ray ${mode} ${k === 0 ? 'best' : ''}`} x1={at.x} y1={at.y} x2={p.px} y2={p.py} strokeWidth={(k === 0 ? 2.6 : 1.4) * scale} pathLength="1"/>; })}
    {at && passages.map(p => { const pp = passagePt[p.id]; return <line key={`${res.q}${p.id}`} className="mm-pray" x1={at.x} y1={at.y} x2={pp.px} y2={pp.py} strokeWidth={1 * scale} strokeDasharray={`${3 * scale} ${4 * scale}`}/>; })}
    {pts.map(p => {
      const base = p.kind === 'card' ? 6.5 : p.kind === 'example' ? 3.4 : 2.4;
      const dim = (focusArea && p.area !== focusArea) || (family && !family.has(p.i)) || (res && !near.has(p.i) && !family);
      const big = near.has(p.i) || family?.has(p.i) || selected === p.card && p.kind === 'card';
      return <g key={p.i} data-dot className={`mm-dot ${p.kind} ${dim ? 'dim' : ''} ${big ? 'on' : ''}`} style={{ '--i': p.i % 9 }}
        onPointerEnter={() => setHover(p)} onClick={() => p.kind !== 'passage' && select(p.card)}>
        {p.kind === 'card' && <circle cx={p.px} cy={p.py} r={base * 2.2 * scale} fill={AREA_COLOR[p.area]} className="halo" filter="url(#mm-glow)"/>}
        <circle cx={p.px} cy={p.py} r={(big ? base * 1.35 : base) * scale} fill={AREA_COLOR[p.area]} className="core"/>
        {p.kind === 'card' && <circle cx={p.px} cy={p.py} r={16 * scale} fill="transparent" className="hit"/>}
      </g>;
    })}
    {full && at && (() => { const used = []; return top.map((r, k) => { const p = cardPt[r.id]; let y = p.py + 4 * scale;
        // Stack labels whose dots sit on top of each other, so names never overlap.
        for (const u of [...used].sort((a, b) => a.y - b.y)) if (Math.abs(u.x - p.px) < 220 * scale && Math.abs(u.y - y) < 17 * scale) y = u.y + 17 * scale;
        used.push({ x: p.px, y }); return { r, k, p, y }; }); })().map(({ r, k, p, y }) => { const right = p.px < at.x + 300;
      return <g key={`l${r.id}`} className={`mm-tag ${k === 0 ? 'best' : ''}`} transform={`translate(${p.px + (right ? 12 : -12) * scale} ${y})`}>
        <text fontSize={(k === 0 ? 14 : 12) * textScale} textAnchor={right ? 'start' : 'end'}>{cardById[r.id].title.length > 32 ? cardById[r.id].title.slice(0, 31) + '…' : cardById[r.id].title}<tspan className="sc"> {mode === 'meaning' ? r.score.toFixed(2) : `${r.score} pts`}</tspan></text>
      </g>; })}
    {at && <g key={`you${res.q}${mode}`} className="mm-you" style={{ '--x': `${at.x}px`, '--y': `${at.y}px`, '--sx': `${vb.x + vb.w / 2}px`, '--sy': `${vb.y + vb.h}px` }}>
      <circle r={22 * scale} className="ring"/><circle r={22 * scale} className="ring r2"/>
      <circle r={9 * scale} className="core"/>
      <text y={34 * scale} fontSize={12 * textScale} textAnchor="middle">your question</text>
    </g>}
  </svg>;
}

function Panel({ state, actions, onOpen }) {
  const { res, mode, selected, busy } = state;
  const shown = res && (mode === 'meaning' ? res.meaning : res.keyword);
  if (selected) {
    const c = cardById[selected];
    return <div className="mm-panel">
      <span className="mm-pill" style={{ '--c': AREA_COLOR[areaOf[selected]?.area] }}>{AREA_NAME[areaOf[selected]?.area]}</span>
      <h4>{c.title}</h4><p>{c.summary}</p>
      <span className="mm-sub">Questions that live here</span>
      <ul className="mm-exlist">{c.examples.map(e => <li key={e}><button onClick={() => actions.run(e)}>“{e}”</button></li>)}</ul>
      <div className="mm-panel-actions">{onOpen && <button className="primary" onClick={() => onOpen(selected)}>Open guide</button>}<button onClick={() => actions.select(null)}>Back</button></div>
    </div>;
  }
  if (!res) return <div className="mm-panel intro">
    <h4>How to read this</h4>
    <ul className="mm-how"><li><i className="d card"/>Big dots are <b>services</b></li><li><i className="d ex"/>Small dots are <b>example questions</b>, threaded to their service</li><li><i className="d fq"/>Tiny dots are <b>official FAQ passages</b></li></ul>
    <p>Close together means <b>close in meaning</b>, whatever the words or language. Ask something, or tap a service.</p>
  </div>;
  const kwTop = res.keyword.results[0];
  const mTop = res.meaning.results?.[0];
  const agree = kwTop?.score > 0 && mTop && kwTop.id === mTop.id;
  return <div className="mm-panel">
    <span className="mm-sub">{busy ? 'Thinking…' : mode === 'meaning' ? 'Semantic search · HobbyLM-Embed' : 'Keyword search · matching words'}</span>
    <h4>“{res.q}”</h4>
    <ol className="mm-bars">{(shown.results || []).filter(r => mode === 'keyword' ? r.score > 0 : true).map((r, k) => {
      const v = mode === 'meaning' ? r.score : r.score / ((shown.results[0]?.score) || 1);
      return <li key={r.id} className={k === 0 ? 'best' : ''}><button onClick={() => actions.select(r.id)}>
        <span className="t">{cardById[r.id].title}</span><span className="v">{mode === 'meaning' ? r.score.toFixed(2) : `${r.score} pts`}</span>
        <span className="bar"><i style={{ width: `${Math.max(4, v * 100)}%`, background: mode === 'meaning' ? '#b7f34a' : '#c7ccbe' }}/></span></button></li>; })}
      {mode === 'keyword' && !(kwTop?.score > 0) && <li className="none">No words matched any service.</li>}</ol>
    {mode === 'meaning' && shown.passages?.length > 0 && <p className="mm-ret"><b>Retrieval:</b> also ranked {shown.passages_compared} official FAQ passages; dotted lines point to the closest.</p>}
    <p className={`mm-vs ${agree ? 'same' : 'diff'}`}>{agree ? 'Matching words picks the same service this time.' : <>Matching words alone would pick <b>{kwTop?.score > 0 ? cardById[kwTop.id].title : 'nothing'}</b>. <button onClick={() => actions.setMode(mode === 'meaning' ? 'keyword' : 'meaning')}>Compare ↔</button></>}</p>
    <p className="mm-note">Above {(res.meaning.threshold ?? .7).toFixed(2)} counts as a match; otherwise the guide says “Not covered yet”.</p>
  </div>;
}

export default function MeaningMap({ privateSearch, onOpen }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [mode, setMode] = useState('meaning');
  const [hover, setHover] = useState(null);
  const [focusArea, setFocusArea] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const [demo, setDemo] = useState(false);
  const view = useViewBox();
  const runId = useRef(0);

  async function run(text) {
    const t = text.trim(); if (!t) return;
    const id = ++runId.current; setQ(t); setBusy(true); setSelected(null);
    // Local mode: question text never leaves this device — keyword answers while the Mini loads.
    const meaning = (privateSearch && await privateSearch(t).catch(() => null))
      || (SEARCH_MODE !== 'server' ? keywordSearch(t) : await searchQuestion(t));
    if (id === runId.current) { setRes({ q: t, meaning, keyword: keywordSearch(t) }); setMode('meaning'); setBusy(false); }
  }
  const select = id => { setSelected(id); };
  useEffect(() => { if (!demo || !full) return; let k = 0; run(EXAMPLES[0]); const t = setInterval(() => { k = (k + 1) % EXAMPLES.length; run(EXAMPLES[k]); }, 5200); return () => clearInterval(t); }, [demo, full]);
  useEffect(() => {
    if (!full) { view.setVb(FULL); return; }
    const previous = document.activeElement, before = document.body.style.overflow;
    const modal = document.querySelector('.mm-modal');
    modal?.querySelector('input,button')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') setFull(false);
      if (e.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button,input,a,[tabindex="0"]')].filter(el => !el.disabled);
      if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus(); }
    };
    addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = before; previous?.focus(); };
  }, [full]);

  const state = { res, mode, hover, focusArea, selected, busy, view };
  const actions = { setHover, select, run, setMode };
  const tip = hover && <div className="mm-tip"><span style={{ color: AREA_COLOR[hover.area] }}>●</span> <small>{AREA_NAME[hover.area]} · {hover.kind === 'card' ? 'service' : hover.kind === 'example' ? 'example question' : 'official FAQ passage'}</small><b>{hover.text}</b></div>;
  const ask = <form className="mm-ask" onSubmit={e => { e.preventDefault(); setDemo(false); run(q); }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask anything, e.g. thela lagane ke liye loan chahiye" aria-label="Place a question on the map of meaning" maxLength={120}/>
    <button disabled={busy || !q.trim()}>{busy ? '…' : 'Place it'}</button>
  </form>;
  const chips = <div className="mm-chips">{EXAMPLES.map(e => <button key={e} onClick={() => { setDemo(false); run(e); }}>{e}</button>)}</div>;
  const tabs = <div className="mm-tabs" role="tablist" aria-label="Search method">
    <button role="tab" aria-selected={mode === 'meaning'} onClick={() => setMode('meaning')}>By meaning</button>
    <button role="tab" aria-selected={mode === 'keyword'} onClick={() => setMode('keyword')}>By matching words</button>
  </div>;
  const legend = <div className="mm-legend">{knowledge.areas.map(a => <button key={a.id} aria-pressed={focusArea === a.id} onClick={() => setFocusArea(f => f === a.id ? null : a.id)}><i style={{ background: AREA_COLOR[a.id] }}/>{a.name}</button>)}</div>;

  return <section className="mm-wrap mm-compact" aria-labelledby="mm-title">
    <article className="mm-demo-card">
      <h2 id="mm-title">How search works</h2>
      <p>See how HobbyIndia connects a question with a service.</p>
      <button className="mm-expand mm-demo-open" onClick={() => setFull(true)}><Maximize2 size={16} aria-hidden="true"/>Explore the demo</button>
    </article>

    {full && createPortal(<div className="mm-modal" role="dialog" aria-modal="true" aria-label="Map of meaning, full screen">
      <div className="mm-modal-head">
        <div><h2 className="mm-modal-title">A map of meaning</h2>{ask}</div>
        <div className="mm-modal-tools">{tabs}
          <button className="mm-icon" onClick={() => setDemo(d => !d)} aria-pressed={demo} title={demo ? 'Pause demo' : 'Play demo'}>{demo ? <Pause size={16}/> : <Play size={16}/>}<span>{demo ? 'Pause' : 'Play demo'}</span></button>
          <button className="mm-icon" onClick={() => setFull(false)} aria-label="Close full screen"><Close size={18}/></button></div>
      </div>
      <div className="mm-modal-body">
        <div className="mm-stage big"><Map full state={state} actions={actions}/>{tip}
          <div className="mm-zoom"><button onClick={() => { const v = view.vb; view.glide(view.around(v.x + v.w / 2, v.y + v.h / 2, Math.max(180, v.w / 1.4))); }} aria-label="Zoom in"><Plus size={16}/></button>
            <button onClick={() => { const v = view.vb; view.glide(view.around(v.x + v.w / 2, v.y + v.h / 2, Math.min(W * 1.4, v.w * 1.4))); }} aria-label="Zoom out"><Minus size={16}/></button>
            <button onClick={() => { view.glide(FULL); setSelected(null); }} aria-label="Reset view"><RotateCcw size={15}/></button></div>
          {chips}
        </div>
        <Panel state={state} actions={actions} onOpen={id => { setFull(false); onOpen?.(id); }}/>
      </div>
      <div className="mm-modal-foot">{legend}<span>2D picture (t-SNE) of the 512-number space; search always uses the full numbers. Scroll to zoom, drag to move.</span></div>
    </div>, document.body)}
  </section>;
}
