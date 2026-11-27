import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ChevronLeft, ChevronRight, Info, Pause, Play, X } from 'lucide-react';
import './styles.css';
import ServiceCollage from './ServiceCollage';
import ExperimentPanel from './ExperimentPanel';
import { matchScenario } from './scenarioMatch';
import SearchResults from './SearchResults';
import { searchQuestion, API_BASE } from './search';
import PrivateModeControl, { usePrivateMode } from './PrivateMode';

// The live HobbyLM-1B generation experiment stays off for the public launch.
const SHOW_LIVE = false;
const SLIDE_MS = 2500; // each slide stays at least 2 seconds

const slides = [
  { image: 'gandhi-dj.webp', label: 'Gandhi DJing', alt: 'A playful imagined black-and-white scene of Gandhi DJing.', prompt: 'My government complaint was closed. What next?', position: 'center top', offset: 64, background: '#f5fcf5' },
  { image: 'phule.webp', label: 'Jyotirao and Savitribai Phule', alt: 'An imagined portrait of Jyotirao and Savitribai in rural Maharashtra.', prompt: 'Where do I start with a scholarship application?', position: 'center top', offset: 64, background: '#d4dfec' },
  { image: 'nehru.webp', label: 'Nehru on the telephone', alt: 'An imagined portrait of Nehru in a suit, speaking on a telephone.', prompt: 'Which department handles my problem?', position: 'center 36%' },
  { image: 'rani-bhagat.webp', label: 'Rani Lakshmibai and Bhagat Singh', alt: 'An imagined scene of Rani Lakshmibai and Bhagat Singh beside the sea.', prompt: 'How do I find the right official service?', position: 'right top', offset: 88, background: '#b9dcf1' },
  { image: 'ambedkar.webp', label: 'Ambedkar at the podium', alt: 'An imagined portrait of Ambedkar speaking at a podium.', prompt: 'My RTI request has no reply. What can I check?', position: 'center 38%' },
  { image: 'bose-portrait.webp', label: 'Subhas Chandra Bose portrait', alt: 'A supplied portrait of Subhas Chandra Bose in uniform, seated and smiling.', prompt: 'Where is the official Udyam registration portal?', position: 'center 17%', offset: 64, background: '#2e2a25' },
];

const pages = {
  'How it works': ['A question. A clearer next step.', 'We are testing how well HobbyLM-1B can interpret public-service questions and select guidance grounded in reviewed official sources.', 'The local CPGRAMS experiment retrieves a saved draft passage and sends it with your question to HobbyLM. Other service panels remain concept previews.'],
  Privacy: ['Your question stays here.', 'Your question is sent to our search service only to find matching cards. It is not stored or logged, and anything that looks like an Aadhaar, phone or PAN number is removed first. With the live HobbyLM switch on, questions go to the local experiment instead. Nothing is submitted to a government portal.', 'Do not enter identity numbers, passwords, OTPs or private case documents. The data policy will be reviewed before the model-backed release.'],
  About: ['A small model. A useful experiment.', 'HobbyLM is a 1B model. This project tests what it can do for everyday Indian public-service questions, with frozen evaluations and honest failure reports.', 'This is an independent experiment, not an official government website. The supplied historical images are imaginative illustrations.'],
  'Coming soon': ['The model-backed guide.', 'Next: evaluate HobbyLM’s question interpretation, clarification and routing against a deterministic baseline, then connect passing behavior to reviewed guides.', 'Forms, accounts, uploads, payments and final submissions remain on official services.'],
  FAQ: ['What can I use today?', 'You can explore the images, question entry and navigation. The CPGRAMS experiment generates unverified model responses using draft saved evidence. Detailed reviewed guidance is not available.', 'Will it cover everything? No. Published coverage will be labeled as reviewed guidance, official route only, or not covered.'],
  'Submit feedback': ['Feedback comes next.', 'Feedback collection is not enabled in this local preview. You can review the interface with the project team without submitting personal information.'],
};

const authoredStages = () => [
  { label: 'Matching a prepared scenario', icon: 'match', state: 'active' },
  { label: 'Opening saved evidence', icon: 'evidence', state: 'pending' },
  { label: 'Showing an authored next step', icon: 'authored', state: 'pending' },
];
const liveStages = () => [
  { label: 'Question sent to the local experiment API', icon: 'send', state: 'done' },
  { label: 'Waiting for HobbyLM-1B output', icon: 'model', state: 'active' },
  { label: 'Model output received', icon: 'received', state: 'pending' },
];
const OFFLINE = 'The local experiment server is unavailable. Start it on port 8790 and try again.';
// Only a failed network request means the server is unreachable; other errors keep their own message.
async function request(url, options) {
  let response;
  try { response = await fetch(url, options); } catch { throw new Error(OFFLINE); }
  if (response.status >= 502) throw new Error(OFFLINE);
  return response;
}
const setStage = (stages, i, state, note) => stages.map((stage, n) => n === i ? { ...stage, state, ...(note ? { note } : {}) } : stage);

function Flag() {
  return <svg className="flag" viewBox="0 0 30 20" aria-label="India" role="img"><path fill="#ff9933" d="M0 0h30v6.67H0z"/><path fill="#fff" d="M0 6.67h30v6.67H0z"/><path fill="#138808" d="M0 13.33h30V20H0z"/><circle cx="15" cy="10" r="2.5" fill="none" stroke="#002664" strokeWidth=".5"/>{Array.from({ length: 24 }, (_, i) => <path key={i} d="M15 10v-2.3" stroke="#002664" strokeWidth=".15" transform={`rotate(${i * 15} 15 10)`}/>)}</svg>;
}

function App() {
  const [index, setIndex] = useState(0);
  // Slides advance on their own (unless the visitor prefers reduced motion); arrows don't stop it.
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState(null);
  const pm = usePrivateMode();
  const searchId = useRef(0);
  const turnId = useRef(0);
  const [panel, setPanel] = useState(null);
  const [focused, setFocused] = useState(false);
  const menuButton = useRef(null);
  const dialog = useRef(null);
  const previousFocus = useRef(null);
  const slide = slides[index];

  const advance = (amount) => setIndex(i => (i + amount + slides.length) % slides.length);
  useEffect(() => {
    if (!playing || focused || panel) return;
    const timer = setTimeout(() => { if (!document.hidden) advance(1); }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, focused, panel, index]);
  useEffect(() => {
    if (!panel) return;
    previousFocus.current = document.activeElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button')?.focus();
    return () => { document.body.style.overflow = before; previousFocus.current?.focus(); };
  }, [Boolean(panel)]);
  useEffect(() => { if (panel) dialog.current?.querySelector('button')?.focus(); }, [panel]);

  function close() { setPanel(null); }
  function trap(event) {
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.current.querySelectorAll('button,a,input')];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const updateTurn = (id, patch) => setTurns(list => list.map(t => t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t));
  const scrollToPanel = () => requestAnimationFrame(() => document.getElementById('next-step')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));

  async function openScenario(id, topic = 'cpgrams') {
    updateTurn(id, t => ({ status: 'working', stages: setStage(setStage(t.stages, 0, 'done'), 1, 'active') }));
    const started = performance.now();
    const response = await request(`/api/v1/scenarios/${topic}`);
    const scenario = await response.json();
    // The page's own request, shown on the trace exactly as it happened.
    const call = { method: 'GET', path: `/v1/scenarios/${topic}`, status: response.status, ms: Math.round(performance.now() - started) };
    if (!response.ok) throw new Error(scenario.error || 'The saved scenario could not be opened.');
    // Refuse to present anything not explicitly attributed as authored, non-model content.
    if (scenario.mode !== 'authored_demo' || scenario.generated_by_hobbylm !== false) throw new Error('The scenario is missing its authored-content attribution, so it is not shown.');
    updateTurn(id, t => ({ status: 'done', kind: 'scenario', scenario, call, choice: null, stages: setStage(setStage(t.stages, 1, 'done'), 2, 'done') }));
  }

  async function runAuthored(id, question) {
    const match = matchScenario(question);
    if (match === 'rti') { await openScenario(id, 'rti'); return; }
    if (match !== 'scenario') {
      const note = match === 'which_case' ? 'Two prepared paths are possible' : 'No prepared scenario matches';
      updateTurn(id, t => ({ status: 'done', kind: match, stages: setStage(setStage(setStage(t.stages, 0, 'done', note), 1, 'skipped'), 2, match === 'which_case' ? 'pending' : 'skipped') }));
      return;
    }
    await openScenario(id);
  }

  async function runLive(id, question) {
    const history = turns.filter(t => t.kind === 'live').flatMap(t => [{ role: 'user', content: t.question }, { role: 'assistant', content: t.result.output || '(empty response)' }]);
    const started = performance.now();
    const response = await request('/api/v1/experiments/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'rag', question, history }) });
    const result = await response.json();
    const call = { method: 'POST', path: '/v1/experiments/generate', status: response.status, ms: Math.round(performance.now() - started) };
    // 400 is the experiment declining an out-of-scope question: a real answer, not a retryable failure.
    if (response.status === 400) { updateTurn(id, t => ({ status: 'done', kind: 'live_refused', refusal: result.error, call, stages: setStage(setStage(t.stages, 1, 'done', 'Declined by the experiment API'), 2, 'skipped') })); return; }
    if (!response.ok) throw new Error(result.error || 'The experiment could not complete.');
    updateTurn(id, t => ({ status: 'done', kind: 'live', result, call, stages: setStage(setStage(t.stages, 1, 'done'), 2, 'done') }));
  }

  async function run(id, mode, question) {
    setBusy(true);
    try { await (mode === 'live' ? runLive(id, question) : runAuthored(id, question)); }
    catch (error) {
      updateTurn(id, t => ({ status: 'error', error: error.message || 'The request could not complete.', stages: t.stages.map(stage => stage.state === 'active' ? { ...stage, state: 'pending' } : stage) }));
    } finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setPlaying(false); setMessage('');
    const question = query.trim();
    if (!live) { await runSearch(question); return; }
    const mode = 'live'; const id = ++turnId.current;
    setTurns(list => [...list, { id, mode, question, status: 'working', stages: mode === 'live' ? liveStages() : authoredStages() }]);
    setQuery(''); scrollToPanel();
    await run(id, mode, question);
  }

  async function runSearch(question) {
    const id = ++searchId.current;
    setQuery(''); setBusy(true);
    setSearch({ question, status: 'working' });
    requestAnimationFrame(() => document.getElementById('search-results')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    try {
      let data = null;
      if (pm.search) data = await pm.search(question).catch(() => null);
      if (!data) data = await searchQuestion(question);
      const waking = data.source === 'keyword';
      if (id === searchId.current) setSearch({ question, status: 'done', data, waking });
      if (waking) wakeAndRetry(id, question);
    } finally { if (id === searchId.current) setBusy(false); }
  }

  // A free Space sleeps when idle. Show quick keyword results now, then swap in the
  // HobbyLM-Embed answer once the server is awake (checked every 5 s for about 2 minutes).
  async function wakeAndRetry(id, question) {
    for (let i = 0; i < 24 && id === searchId.current; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const ok = await fetch(`${API_BASE}/api/health`).then(r => r.ok).catch(() => false);
      if (!ok || id !== searchId.current) continue;
      const data = await searchQuestion(question);
      if (id !== searchId.current) return;
      if (data.source === 'embedding') { setSearch({ question, status: 'done', data, waking: false, upgraded: true }); return; }
    }
    if (id === searchId.current) setSearch(s => s && { ...s, waking: false });
  }

  function pickCase(id, which) {
    if (which === 'details') { updateTurn(id, t => ({ kind: 'details', stages: setStage(t.stages, 2, 'skipped') })); return; }
    setBusy(true);
    openScenario(id).catch(error => updateTurn(id, { status: 'error', error: error.message })).finally(() => setBusy(false));
  }

  function tryLive(question) {
    setLive(true); setQuery(question);
    document.getElementById('question')?.focus({ preventScroll: false });
  }

  function retry(turn) {
    updateTurn(turn.id, { status: 'working', error: '', stages: turn.mode === 'live' ? liveStages() : authoredStages() });
    run(turn.id, turn.mode, turn.question);
  }

  return <>
    <a className="skip-link" href="#main">Skip to main content</a>
    <div className="experiment-strip"><button onClick={() => setPanel('About')}>HobbyIndia · Independent guide by Fuel Labs. Not a government website. <Info size={14}/></button><span className="emergency-strip">Emergency <a href="tel:112">112</a> · Cyber fraud <a href="tel:1930">1930</a> / <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a></span></div>
    <main id="main" className="hero-shell">
      <header className="site-header"><a className="fuel-home" href="#main" aria-label="HobbyIndia home"><span className="fuel-wordmark"><span>hobby</span><span className="fuel-labs">india</span><span className="fuel-square" aria-hidden="true" /></span></a><button ref={menuButton} className="menu-trigger" aria-expanded={panel === 'Menu'} aria-controls="site-panel" onClick={() => setPanel('Menu')}>Menu</button></header>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Hello, India</h1>
        <p className="subtitle">Find your next step for Indian public services.</p>
        <div className="carousel" aria-roledescription="carousel" aria-label="Indian illustrations and example questions" onKeyDown={event => {
          if (event.target instanceof HTMLInputElement) return;
          if (event.key === 'ArrowLeft') advance(-1);
          if (event.key === 'ArrowRight') advance(1);
        }}>
          <div className="photo-frame" style={{ backgroundColor: slide.background || '#eef4ee' }}>
            {slides.map((item, i) => <img key={item.image} className={`slide-image ${i === 0 ? 'gandhi-image' : ''} ${i === 1 || i === 3 ? 'landscape-image' : ''} ${i === index ? 'active' : ''}`} src={`/images/${item.image}`} alt={i === index ? item.alt : ''} aria-hidden={i !== index} style={{ objectPosition: item.position, ...(item.offset ? { top: item.offset, height: `calc(100% - ${item.offset}px)` } : {}) }} loading={i < 2 ? 'eager' : 'lazy'} />)}
            <form className="composer" onSubmit={submit}>
              <label className="sr-only" htmlFor="question">Describe what you need</label>
              <input id="question" value={query} placeholder={`Try ‘${slide.prompt}’`} autoComplete="off" maxLength={500} onChange={e => { setQuery(e.target.value); setMessage(''); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
              <button className="send-button" type="submit" disabled={busy || !query.trim()} aria-label="Ask a question"><ArrowRight size={23}/></button>
            </form>
          </div>
          <div className="carousel-controls"><button aria-label="Previous image" onClick={() => advance(-1)}><ChevronLeft size={22}/></button><button aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button aria-label="Next image" onClick={() => advance(1)}><ChevronRight size={22}/></button></div>
          <p className="sr-only" aria-live={playing ? 'off' : 'polite'}>{index + 1} of {slides.length}: {slide.label}</p>
        </div>
        {message && <p className="question-status" role="status">{message}</p>}
        {SHOW_LIVE && <div className="mode-row"><button type="button" role="switch" aria-checked={live} className="live-switch" onClick={() => setLive(v => !v)}><span aria-hidden="true"/>Try live HobbyLM · experimental</button>{live && <p>Your next question goes to the local 1B model. Output may be wrong.</p>}</div>}
        <PrivateModeControl pm={pm}/>
        <p className="preview-note">Open source, made in India, no login, stores nothing.<br/>Independent guide by Fuel Labs. Not a government website.</p>
      </section>
    </main>
    <SearchResults search={search} onClear={() => { setSearch(null); document.getElementById('question')?.focus(); }}/>
    <ExperimentPanel turns={turns} busy={busy} live={live} onLiveChange={setLive} onReset={() => { setTurns([]); setMessage(''); document.getElementById('question')?.focus(); }} onChoose={(id, choice) => updateTurn(id, { choice })} onPickCase={pickCase} onTryLive={tryLive} onRetry={retry}/>
    <ServiceCollage hideComposer={turns.length > 0}/>
    {panel && <div className="panel-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <section id="site-panel" ref={dialog} className={`site-panel ${panel !== 'Menu' ? 'information-panel' : ''} ${panel === 'About' ? 'about-panel' : ''}`} role="dialog" aria-modal="true" aria-label={panel} onKeyDown={trap}>
        <button className="close-button" aria-label="Close menu or information" onClick={close}><X size={22}/></button>
        {panel === 'Menu' ? <><nav aria-label="Main navigation"><button className="current" onClick={() => { close(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Home</button>{Object.keys(pages).map(name => <button key={name} onClick={() => setPanel(name)}>{name}</button>)}</nav><div className="disclosure"><Flag/><p>HobbyLM-1B public-service experiment.<br/>Not an official government website.</p></div></> : <article><h2>{pages[panel][0]}</h2>{pages[panel].slice(1).map(text => <p key={text}>{text}</p>)}<button className="back-button" onClick={() => setPanel('Menu')}><ChevronLeft size={18}/>Back to menu</button></article>}
      </section>
    </div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
