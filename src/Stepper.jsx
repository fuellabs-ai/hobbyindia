import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, HelpCircle, LifeBuoy, Phone, Printer, RotateCcw } from 'lucide-react';
import { cardById, safeUrl } from './search';
import './stepper.css';

// Guidance, document names, options and destinations always come from the data.
// Only journey controls are authored here. Checklists live in component memory.
function journeySteps(flow, path) {
  const steps = [];
  let questions = [];
  const addQuestions = () => {
    if (questions.length) steps.push({ kind: 'questions', key: `questions-${questions[0].key}`, questions });
    questions = [];
  };
  for (const visit of path) {
    const node = flow.nodes[visit.id];
    if (node.ask) questions.push(visit);
    else {
      addQuestions();
      for (const kind of ['ready', 'action', 'check']) steps.push({ kind, key: `${kind}-${visit.key}`, visit, node });
    }
  }
  if (questions.length) {
    addQuestions();
    for (const kind of ['ready', 'action', 'check']) steps.push({ kind, key: `pending-${kind}`, pending: true });
  }
  return steps;
}

export default function Stepper({ flow, card: suppliedCard, onTrail }) {
  const card = suppliedCard || cardById[flow?.cards[0]];
  const uid = useId();
  const serial = useRef(0);
  const [path, setPath] = useState(() => flow ? [{ id: flow.start, key: 'visit-0', choice: null, phase: 'ready', outcome: null }] : []);
  const [checks, setChecks] = useState({});
  const [editing, setEditing] = useState(null);
  const [fallbackPhase, setFallbackPhase] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const headings = useRef(new Map());
  const trailCallback = useRef(onTrail);
  useEffect(() => { trailCallback.current = onTrail; }, [onTrail]);
  const steps = useMemo(() => flow ? journeySteps(flow, path) : [
    { kind: 'site', key: 'site' }, { kind: 'followup', key: 'followup' },
  ], [flow, path]);
  const last = path.at(-1);
  const finished = !editing && (flow ? last?.outcome?.type === 'yes' : fallbackPhase === 2);
  let active = 0;
  if (flow) {
    if (editing) active = steps.findIndex(s => s.kind === 'questions' ? s.questions.some(q => q.key === editing) : s.kind === 'check' && s.visit?.key === editing);
    else if (flow.nodes[last.id].ask) active = steps.findIndex(s => s.questions?.some(q => q.key === last.key));
    else active = steps.findIndex(s => s.visit?.key === last.key && s.kind === last.phase);
  } else active = Math.min(fallbackPhase, 1);
  active = Math.max(0, active);
  const focus = target => { setCollapsed(false); setFocusRequest({ target }); };
  const headingRef = key => element => {
    if (element) headings.current.set(key, element);
    else headings.current.delete(key);
  };
  useEffect(() => {
    if (!focusRequest) return;
    const element = headings.current.get(focusRequest.target);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [focusRequest]);

  // Keep the original route-graph contract. Store the chosen OPTION INDEX, not
  // just its destination: several legal-aid answers lead to the same node.
  useEffect(() => {
    const trail = [];
    if (flow) for (const visit of path) {
      const node = flow.nodes[visit.id];
      if (node.ask && visit.choice !== null) {
        const pick = node.options[visit.choice];
        trail.push({ ask: node.ask, chosen: pick.label, others: node.options.filter((_, i) => i !== visit.choice).map(o => o.label) });
      } else if (visit.outcome) {
        const pick = visit.outcome.type === 'yes' ? null : node.fails[visit.outcome.index];
        trail.push({ ask: 'Did it work?', chosen: pick?.label || 'Yes', others: pick ? node.fails.filter((_, i) => i !== visit.outcome.index).map(o => o.label) : [] });
      }
    }
    const node = flow ? flow.nodes[last.id] : null;
    const link = flow ? node.link : card && { url: card.official_url, label: card.official_name };
    const url = link && safeUrl(link.url);
    trailCallback.current?.(trail, url ? { url, label: link.label, authority: node?.authority || card?.official_name || '' } : null);
  }, [path, flow, card]);

  const makeVisit = id => ({ id, key: `visit-${++serial.current}`, choice: null, phase: flow.nodes[id].keep?.length ? 'ready' : 'action', outcome: null });
  const focusVisit = visit => focus(flow.nodes[visit.id].ask ? `question-${visit.key}` : `${visit.phase}-${visit.key}`);
  function commit(next, target) {
    const retained = new Set(next.map(v => v.key));
    setPath(next);
    setChecks(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => retained.has(key))));
    setEditing(null);
    if (target) focus(target);
  }
  function choose(visit, index) {
    const at = path.findIndex(v => v.key === visit.key);
    const next = makeVisit(flow.nodes[visit.id].options[index].next);
    commit([...path.slice(0, at), { ...visit, choice: index }, next]);
    focusVisit(next);
  }
  function advance(visit, phase) {
    // Advancing records navigation through the checklist, not document validation
    // or an official submission. The citizen checks the outcome themselves.
    setPath(previous => previous.map(v => v.key === visit.key ? { ...v, phase } : v));
    setEditing(null);
    focus(`${phase}-${visit.key}`);
  }
  function outcome(visit, index) {
    const at = path.findIndex(v => v.key === visit.key);
    if (index === null) {
      commit([...path.slice(0, at), { ...visit, phase: 'check', outcome: { type: 'yes' } }], 'finished');
    } else {
      const next = makeVisit(flow.nodes[visit.id].fails[index].next);
      commit([...path.slice(0, at), { ...visit, phase: 'check', outcome: { type: 'failure', index } }, next]);
      focusVisit(next);
    }
  }
  function restart() {
    setChecks({}); setEditing(null); setFallbackPhase(0);
    if (flow) {
      const next = makeVisit(flow.start);
      setPath([next]); focusVisit(next);
    } else focus('site');
  }
  const titles = { ready: 'Get these ready', action: 'Do this', check: 'Check it worked', site: 'Go to the official site', followup: "If it doesn't work" };
  const stageTitles = { questions: 'Your situation', ready: 'Get ready', action: 'Official step', check: 'Check result', site: 'Official site', followup: 'Follow up' };
  const stageIcons = { questions: HelpCircle, ready: ClipboardList, action: ArrowUpRight, check: CheckCircle2, site: ArrowUpRight, followup: LifeBuoy };
  // A compact preview follows the current stage; the expanded journey retains
  // every earlier step, including long chains of escalation.
  const miniStart = Math.max(0, Math.min(active - 1, steps.length - 4));
  const officialLink = (link, onClick) => {
    const href = link && safeUrl(link.url);
    return href ? <a className="journey-official" href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      {link.label}<ArrowUpRight size={16} aria-hidden="true"/><span className="sr-only"> (official site, opens in a new tab)</span>
    </a> : null;
  };

  return <section className="journey" data-collapsed={collapsed || undefined} style={{ '--journey-columns': Math.min(4, steps.length) }} aria-label={card?.title || 'Guided next step'}>
    {card && <h3 className="journey-print-title">{card.title}</h3>}
    <header className="journey-header">
      <p className="journey-status" role="status">{finished ? 'Finished' : `Step ${active + 1} of ${steps.length}`}</p>
      <button type="button" className="journey-print" onClick={() => window.print()}><Printer size={16} aria-hidden="true"/>Print / save checklist</button>
      <progress className="journey-progress" max={steps.length} value={finished ? steps.length : active} aria-label="Journey progress" aria-valuetext={finished ? 'Finished' : `Step ${active + 1} of ${steps.length}`}/>
    </header>
    {collapsed && <div className="journey-mini" aria-hidden="true">{steps.slice(miniStart, miniStart + 4).map((step, offset) => {
      const index = miniStart + offset;
      const state = finished || index < active ? 'complete' : index === active ? 'current' : 'upcoming';
      const Icon = state === 'complete' ? Check : stageIcons[step.kind];
      return <span key={step.key} className="journey-mini-step" data-state={state}><span><Icon size={17}/></span></span>;
    })}</div>}
    <ol id={`${uid}-steps`} className="journey-steps" hidden={collapsed}>
      {steps.map((step, index) => {
        const state = finished || index < active ? 'complete' : index === active ? 'current' : 'upcoming';
        const title = step.kind === 'questions' ? flow.nodes[step.questions[0].id].ask : titles[step.kind];
        const labelId = `${uid}-${step.key}`;
        const StageIcon = state === 'complete' ? Check : stageIcons[step.kind];
        return <li key={step.key} className="journey-step" data-state={state} data-pending={step.pending || undefined} aria-current={state === 'current' ? 'step' : undefined}>
          <div className="journey-stage" aria-hidden="true">
            <span className="journey-number"><StageIcon size={21}/></span>
            <span className="journey-stage-label">{index + 1}. {stageTitles[step.kind]}</span>
          </div>
          <div className="journey-content">
            <h4 id={labelId} tabIndex={-1} ref={headingRef(step.kind === 'questions' ? `question-${step.questions[0].key}` : step.key)}>
              {title}{state === 'complete' && <Check size={16} aria-label="Completed"/>}
            </h4>
            {step.kind === 'questions' && step.questions.map((visit, questionIndex) => {
              const node = flow.nodes[visit.id];
              const answered = visit.choice !== null;
              const open = !answered || editing === visit.key;
              const questionLabel = questionIndex ? `${uid}-question-${visit.key}` : labelId;
              return <div key={visit.key} className="journey-question" data-answered={answered || undefined}>
                {questionIndex > 0 && <h5 id={questionLabel} tabIndex={-1} ref={headingRef(`question-${visit.key}`)}>{node.ask}</h5>}
                {answered && <button type="button" className="journey-answer" aria-expanded={open} aria-label={`Change answer: ${node.ask} ${node.options[visit.choice].label}`} onClick={() => { setEditing(open ? null : visit.key); if (!open) focus(`question-${visit.key}`); }}>
                  <Check size={16} aria-hidden="true"/>{node.options[visit.choice].label}
                </button>}
                {open && <div className="journey-options" role="group" aria-labelledby={questionLabel}>
                  {node.options.map((option, optionIndex) => <button type="button" key={optionIndex} aria-pressed={visit.choice === optionIndex} onClick={() => choose(visit, optionIndex)}>{option.label}</button>)}
                </div>}
              </div>;
            })}
            {step.kind === 'ready' && !step.pending && <>
              {step.node.keep?.length > 0 && <div className="journey-checklist" role="group" aria-labelledby={labelId}>
                {step.node.keep.map((item, itemIndex) => <label key={itemIndex} className="journey-item">
                  <input type="checkbox" checked={Boolean(checks[step.visit.key]?.[itemIndex])} onChange={event => {
                    const checked = event.target.checked;
                    setChecks(previous => ({ ...previous, [step.visit.key]: { ...previous[step.visit.key], [itemIndex]: checked } }));
                  }}/><span>{item}</span>
                </label>)}
              </div>}
              {state === 'current' && <button type="button" className="journey-continue" onClick={() => advance(step.visit, 'action')}>Continue</button>}
            </>}
            {step.kind === 'action' && !step.pending && <>
              <p className="journey-instruction">{step.node.step}</p>
              {step.node.authority && <p className="journey-authority">{step.node.authority}</p>}
              <div className="journey-actions">
                {officialLink(step.node.link, () => advance(step.visit, 'check'))}
                {step.node.call?.map((call, callIndex) => /^\+?[0-9]+$/.test(call.tel) && <a key={callIndex} className="journey-call" href={`tel:${call.tel}`} onClick={() => advance(step.visit, 'check')}><Phone size={16} aria-hidden="true"/>{call.label}</a>)}
              </div>
              {state === 'current' && <button type="button" className="journey-continue" onClick={() => advance(step.visit, 'check')}>Check it worked</button>}
            </>}
            {step.kind === 'check' && !step.pending && <>
              {step.visit.outcome && <button type="button" className="journey-answer" aria-expanded={editing === step.visit.key} aria-label={`Change answer: Check it worked ${step.visit.outcome.type === 'yes' ? 'Yes' : step.node.fails[step.visit.outcome.index].label}`} onClick={() => { setEditing(editing === step.visit.key ? null : step.visit.key); focus(step.key); }}>
                <Check size={16} aria-hidden="true"/>{step.visit.outcome.type === 'yes' ? 'Yes' : step.node.fails[step.visit.outcome.index].label}
              </button>}
              {(!step.visit.outcome || editing === step.visit.key) && <div className="journey-options journey-outcomes" role="group" aria-labelledby={labelId}>
                <button type="button" onClick={() => outcome(step.visit, null)}>Yes</button>
                {step.node.fails.map((failure, failureIndex) => <button type="button" key={failureIndex} onClick={() => outcome(step.visit, failureIndex)}>{failure.label}</button>)}
              </div>}
              {step.node.fails.length === 0 && officialLink(step.node.link, () => advance(step.visit, 'check'))}
            </>}
            {(step.kind === 'site' || step.kind === 'followup') && card && <>
              {step.kind === 'site' && <p className="journey-instruction">{card.summary}</p>}
              <p className="journey-authority">{card.official_name}</p>
              <div className="journey-actions">{officialLink({ url: card.official_url, label: card.official_name }, () => { setFallbackPhase(1); focus('followup'); })}</div>
              {step.kind === 'followup' && !finished && <button type="button" className="journey-continue" onClick={() => { setFallbackPhase(2); focus('finished'); }}>Finished</button>}
            </>}
          </div>
        </li>;
      })}
    </ol>
    {finished && <h4 className="journey-finished" tabIndex={-1} ref={headingRef('finished')}><Check size={22} aria-hidden="true"/>Finished</h4>}
    <footer className="journey-footer">
      <span className="journey-service">{card?.title}</span>
      <div className="journey-footer-actions">
        <button type="button" className="journey-reset" onClick={restart}><RotateCcw size={15} aria-hidden="true"/>Start over</button>
        <button type="button" className="journey-toggle" aria-expanded={!collapsed} aria-controls={`${uid}-steps`} aria-label={collapsed ? `Open checklist. ${finished ? 'Finished' : `Step ${active + 1} of ${steps.length}`}` : undefined} onClick={() => setCollapsed(value => !value)}><span>{collapsed ? 'Open checklist' : 'Close checklist'}</span>{collapsed ? <ChevronDown size={17} aria-hidden="true"/> : <ChevronUp size={17} aria-hidden="true"/>}</button>
      </div>
    </footer>
  </section>;
}
