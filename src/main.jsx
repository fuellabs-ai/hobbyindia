import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ChevronLeft, ChevronRight, Info, Pause, Play, X } from 'lucide-react';
import './tokens.css';
import './styles.css';
import SearchResults from './SearchResults';
import { searchQuestion, keywordSearch, API_BASE } from './search';
import PrivateModeControl, { usePrivateMode, SEARCH_MODE } from './PrivateMode';
import MiniStatus, { useMiniMode } from './MiniMode';
import KnowledgeMap, { pathNames } from './KnowledgeMap';
import MeaningMap from './MeaningMap';
import ServiceCollage from './ServiceCollage';
import { cardById } from './search';
import './polish.css';

const SLIDE_MS = 2500; // each slide stays at least 2 seconds
// Plan B (default): the Mini runs in this browser, no search server. Plan C: VITE_SEARCH_MODE=server.
const LOCAL_SEARCH = SEARCH_MODE !== 'server';

const slides = [
  { image: 'gandhi-dj.webp', label: 'Gandhi DJing', alt: 'A playful imagined black-and-white scene of Gandhi DJing.', prompt: 'My government complaint was closed. What next?', position: 'center top', offset: 64, background: '#f5fcf5' },
  { image: 'phule.webp', label: 'Jyotirao and Savitribai Phule', alt: 'An imagined portrait of Jyotirao and Savitribai in rural Maharashtra.', prompt: 'Where do I start with a scholarship application?', position: 'center top', offset: 64, background: '#d4dfec' },
  { image: 'nehru.webp', label: 'Nehru on the telephone', alt: 'An imagined portrait of Nehru in a suit, speaking on a telephone.', prompt: 'Which department handles my problem?', position: 'center 36%' },
  { image: 'rani-bhagat.webp', label: 'Rani Lakshmibai and Bhagat Singh', alt: 'An imagined scene of Rani Lakshmibai and Bhagat Singh beside the sea.', prompt: 'How do I find the right official service?', position: 'right top', offset: 88, background: '#b9dcf1' },
  { image: 'ambedkar.webp', label: 'Ambedkar at the podium', alt: 'An imagined portrait of Ambedkar speaking at a podium.', prompt: 'My RTI request has no reply. What can I check?', position: 'center 38%' },
  { image: 'bose-portrait.webp', label: 'Subhas Chandra Bose portrait', alt: 'A supplied portrait of Subhas Chandra Bose in uniform, seated and smiling.', prompt: 'Where is the official Udyam registration portal?', position: 'center 17%', offset: 64, background: '#2e2a25' },
];

const pages = {
  'How it works': ['Find a service. Plan your next step.', 'Describe what you need, or browse the service map. HobbyIndia matches your question to prepared service cards and step-by-step paths.', 'Each path points to an official service. Check its requirements before applying; the official service decides your case.'],
  Privacy: ['Keep personal details private.', 'Please leave out identity numbers, passwords, OTPs and private case documents. You can describe your situation without sharing them.', LOCAL_SEARCH ? 'Search runs in this browser tab. Opening an official link takes you to that service, where its own privacy policy applies.' : 'Your question is sent to the search service to find matching cards. Opening an official link takes you to that service, where its own privacy policy applies.'],
  About: ['A little clarity for everyday questions.', 'HobbyIndia is an independent guide by Fuel Labs for finding Indian public services and understanding possible next steps.', 'This is not a government website. Guidance comes from prepared service cards; coverage is limited. The historical images are imaginative illustrations.'],
  FAQ: ['A few things to know.', 'What can I do here? Search for a service, explore related areas and follow a prepared step-by-step path. Service cards distinguish reviewed guidance from official routes.', 'Can I apply here? Applications, accounts, uploads, payments and final submissions happen on the official service. Always check current requirements there.'],
  'Submit feedback': ['Help make the guide clearer.', 'Use the feedback controls beside a result to say whether it helped. Please keep personal information out of feedback.', 'Feedback does not submit a complaint or application to a government service.'],
};

function Flag() {
  return <svg className="flag" viewBox="0 0 30 20" aria-label="India" role="img"><path fill="#ff9933" d="M0 0h30v6.67H0z"/><path fill="#fff" d="M0 6.67h30v6.67H0z"/><path fill="#138808" d="M0 13.33h30V20H0z"/><circle cx="15" cy="10" r="2.5" fill="none" stroke="#002664" strokeWidth=".5"/>{Array.from({ length: 24 }, (_, i) => <path key={i} d="M15 10v-2.3" stroke="#002664" strokeWidth=".15" transform={`rotate(${i * 15} 15 10)`}/>)}</svg>;
}

function LiveRoute({ data }) {
  const top = data.results?.[0];
  const src = data.source === 'local' ? 'HobbyLM-Embed Mini · on your device' : data.source === 'private' ? 'HobbyLM-Embed · on your computer' : data.source === 'embedding' ? 'HobbyLM-Embed · live' : 'keyword match';
  if (data.emergency) return <div className="live-route emergency" aria-live="polite"><span className="lr-label"><span className="lr-dot"/>Emergency</span><span className="lr-path">112 and cybercrime.gov.in / 1930 will be shown first</span></div>;
  if (data.reason === 'script_unsupported') return <div className="live-route" aria-live="polite"><span className="lr-label">Tip</span><span className="lr-path">Type in English letters, like “ration card kaise banaye”</span></div>;
  if (!top) return null;
  const names = pathNames(top.id);
  return <div className="live-route" aria-live="polite">
    <span className="lr-label"><span className="lr-dot"/>{data.covered ? 'Heading to' : 'Closest so far'}</span>
    <span className="lr-path">{names.map((n, i) => <React.Fragment key={i}>{i > 0 && <i>›</i>}{n}</React.Fragment>)}</span>
    {typeof top.score === 'number' && data.source !== 'keyword' && <span className="lr-score">{top.score.toFixed(2)}</span>}
    {data.results[1] && <span className="lr-alt">or {pathNames(data.results[1].id).at(-1)}</span>}
    <span className="lr-src">{src}</span>
  </div>;
}

function App() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
    }), { threshold: .08 });
    const els = document.querySelectorAll('.mm-wrap, .km-explore, .site-footer');
    els.forEach(el => {
      if (el.getBoundingClientRect().top > innerHeight) el.classList.add('reveal-pending');
      observer.observe(el);
    });
    // Safety net: never leave content hidden if the observer doesn't fire (slow phones, previews, crawlers).
    const safety = setTimeout(() => els.forEach(el => el.classList.add('revealed')), 2500);
    return () => { observer.disconnect(); clearTimeout(safety); };
  }, []);
  const [index, setIndex] = useState(0);
  // Slides advance on their own (unless the visitor prefers reduced motion); arrows don't stop it.
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(null);
  const pmp = usePrivateMode();
  const mini = useMiniMode(LOCAL_SEARCH);
  const smart = LOCAL_SEARCH ? mini : pmp; // whichever searcher runs the embedding pipeline here
  // Live route while typing: the local Mini re-ranks ~0.4 s after the person pauses. Nothing is sent anywhere.
  const [preview, setPreview] = useState(null);
  const previewId = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) { setPreview(null); return; }
    const id = ++previewId.current;
    const t = setTimeout(async () => {
      const data = await (smart.search ? smart.search(q).catch(() => null) : null) || (LOCAL_SEARCH ? keywordSearch(q) : await searchQuestion(q));
      if (id === previewId.current) setPreview({ q, data });
    }, 400);
    return () => clearTimeout(t);
  }, [query, smart.search]);
  const searchId = useRef(0);
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
  async function submit(event) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setPlaying(false);
    await runSearch(query.trim());
  }

  async function runSearch(question) {
    const id = ++searchId.current;
    setQuery(''); setPreview(null); setBusy(true);
    setSearch({ question, status: 'working' });
    requestAnimationFrame(() => document.getElementById('search-results')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    try {
      let data = null;
      if (smart.search) data = await smart.search(question).catch(() => null);
      // Local mode: keyword answers need no server, so skip the 2 s server timeout while the Mini loads.
      if (!data) data = LOCAL_SEARCH ? keywordSearch(question) : await searchQuestion(question);
      const waking = data.source === 'keyword' && !LOCAL_SEARCH;
      if (id === searchId.current) setSearch({ question, status: 'done', data, waking });
      if (waking) wakeAndRetry(id, question);
    } finally { if (id === searchId.current) setBusy(false); }
  }

  // Local mode: a question answered with keywords while the Mini loaded gets the real
  // smart answer swapped in as soon as the model is ready — but never over a newer question.
  const readySearch = mini.search;
  useEffect(() => {
    if (!LOCAL_SEARCH || !readySearch || !search || search.status !== 'done' || search.data?.source === 'local') return;
    const myId = searchId.current;
    let cancelled = false;
    readySearch(search.question).then(data => {
      if (!cancelled && data && myId === searchId.current) setSearch({ question: search.question, status: 'done', data, upgraded: true });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [readySearch]);

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

  // Opening a service straight from the services map: same answer view, no search needed.
  function openService(cardId) {
    const card = cardById[cardId]; if (!card) return;
    searchId.current++;
    setSearch({ question: card.title, status: 'done', data: { source: 'browse', covered: true, emergency: false, results: [{ id: cardId, score: null }], passages: [] } });
    requestAnimationFrame(() => document.getElementById('search-results')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  return <>
    <a className="skip-link" href="#main">Skip to main content</a>
    <div className="experiment-strip"><button onClick={() => setPanel('About')}>HobbyIndia · Independent guide by Fuel Labs. Not a government website. <Info size={14}/></button><span className="emergency-strip">Emergency <a href="tel:112">112</a></span></div>
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
              <input id="question" value={query} placeholder={`Try ‘${slide.prompt}’`} autoComplete="off" maxLength={500} onChange={e => { setQuery(e.target.value); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
              <button className="send-button" type="submit" disabled={busy || !query.trim()} aria-label="Ask a question"><ArrowRight size={23}/></button>
            </form>
          </div>
          <div className="carousel-controls"><button aria-label="Previous image" onClick={() => advance(-1)}><ChevronLeft size={22}/></button><button aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button aria-label="Next image" onClick={() => advance(1)}><ChevronRight size={22}/></button></div>
          <p className="sr-only" aria-live={playing ? 'off' : 'polite'}>{index + 1} of {slides.length}: {slide.label}</p>
        </div>
        <div className="route-preview-slot">{preview && <LiveRoute data={preview.data}/>}</div>
        <div className="model-status-slot" aria-busy={LOCAL_SEARCH && mini.status === 'loading'}>{LOCAL_SEARCH ? <MiniStatus mini={mini}/> : <PrivateModeControl pm={pmp}/>}</div>
        <p className="preview-note">Independent guide by Fuel Labs. Not a government website.</p>
      </section>
    </main>
    <SearchResults search={search} onClear={() => { setSearch(null); document.getElementById('question')?.focus(); }}/>
    <ServiceCollage onAsk={q => { runSearch(q); }}/>
    {/* Homepage = 3 sections (hero, statement, service cards). The deeper explainers appear only after someone asks. */}
    {search && <MeaningMap privateSearch={smart.search} onOpen={openService}/>}
    {search && <div className="km-explore" id="explore"><KnowledgeMap previewId={preview?.data?.results?.[0]?.id} title="Explore India’s services" intro="36 services across 8 areas. Open an area, then tap a service to see who handles it and where to go." onOpen={openService}/></div>}
    <footer className="site-footer"><a href="#main" className="fuel-home">HobbyIndia</a><p>Independent guide by Fuel Labs.<br/>Not a government website.</p><a className="footer-emergency" href="tel:112">Emergency 112</a></footer>
    {panel && <div className="panel-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <section id="site-panel" ref={dialog} className={`site-panel ${panel !== 'Menu' ? 'information-panel' : ''} ${panel === 'About' ? 'about-panel' : ''}`} role="dialog" aria-modal="true" aria-label={panel} onKeyDown={trap}>
        <button className="close-button" aria-label="Close menu or information" onClick={close}><X size={22}/></button>
        {panel === 'Menu' ? <><nav aria-label="Main navigation"><button className="current" onClick={() => { close(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>Home</button>{Object.keys(pages).map(name => <button key={name} onClick={() => setPanel(name)}>{name}</button>)}</nav><div className="disclosure"><Flag/><p>An independent guide by Fuel Labs.<br/>Not a government website.</p></div></> : <article><h2>{pages[panel][0]}</h2>{pages[panel].slice(1).map(text => <p key={text}>{text}</p>)}<button className="back-button" onClick={() => setPanel('Menu')}><ChevronLeft size={18}/>Back to menu</button></article>}
      </section>
    </div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
