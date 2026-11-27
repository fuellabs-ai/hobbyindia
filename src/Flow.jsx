import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, Phone, RotateCcw } from 'lucide-react';
import flowData from '../data/flows.json';
import { safeUrl } from './search';

// "Keep ready" document lists. One switch, in case we decide to drop them.
export const SHOW_KEEP_READY = true;

export const flowByCard = Object.fromEntries(flowData.flows.flatMap(f => f.cards.map(c => [c, f])));
const CHECKED = new Date(flowData.checked_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// A decision flow: one question at a time, ending in one next step, the authority, one official
// button, and "Did it work?". Every word is pre-written in data/flows.json; nothing is generated.
export default function Flow({ flow }) {
  const [path, setPath] = useState([flow.start]);
  const [done, setDone] = useState(false);
  const heading = useRef(null);
  const id = path.at(-1);
  const node = flow.nodes[id];
  useEffect(() => { setPath([flow.start]); setDone(false); }, [flow.id]);
  useEffect(() => { if (path.length > 1) heading.current?.focus(); }, [id, done]);
  const go = next => { setDone(false); setPath(p => [...p, next]); };
  const back = () => { setDone(false); setPath(p => p.slice(0, -1)); };
  const restart = () => { setDone(false); setPath([flow.start]); };
  const href = node.link && safeUrl(node.link.url);

  return <section className="flow" aria-label="Guided next step">
    {node.ask ? <>
      <h4 ref={heading} tabIndex={-1}>{node.ask}</h4>
      <div className="flow-options" role="group" aria-label={node.ask}>
        {node.options.map(o => <button key={o.label} onClick={() => go(o.next)}>{o.label}</button>)}
      </div>
    </> : <>
      <h4 ref={heading} tabIndex={-1}>{node.step}</h4>
      {node.authority && <p className="flow-authority"><span>Handled by</span> {node.authority}</p>}
      {SHOW_KEEP_READY && node.keep?.length > 0 && <div className="flow-keep"><span>Keep ready</span><ul>{node.keep.map(k => <li key={k}>{k}</li>)}</ul></div>}
      <div className="flow-actions">
        {href && <a className="official-link" href={href} target="_blank" rel="noopener noreferrer">{node.link.label}<ArrowUpRight size={16}/><span className="sr-only"> (official site, opens in a new tab)</span></a>}
        {node.call?.map(c => <a key={c.tel} className="flow-call" href={`tel:${c.tel}`}><Phone size={15} aria-hidden="true"/>{c.label}</a>)}
      </div>
      <p className="flow-note">You apply on the official site. We don't see or submit anything.</p>
      {done ? <p className="flow-done" role="status">Good. That's the official step done.</p> : <div className="flow-worked">
        <span>Did it work?</span>
        <div className="flow-options small" role="group" aria-label="Did it work?">
          <button onClick={() => setDone(true)}>Yes</button>
          {node.fails.map(f => <button key={f.label} onClick={() => go(f.next)}>{f.label}</button>)}
          {node.fails.length === 0 && <span className="flow-end">If not, the official service above is the right place to follow up.</span>}
        </div>
      </div>}
    </>}
    <div className="flow-footer">
      {path.length > 1 && <button onClick={back}><ChevronLeft size={15}/>Back</button>}
      {path.length > 1 && <button onClick={restart}><RotateCcw size={14}/>Start over</button>}
      <span>Checked by Fuel Labs, {CHECKED}. Rules can change: the official site decides.</span>
    </div>
  </section>;
}
