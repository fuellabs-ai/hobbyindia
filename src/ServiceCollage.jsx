import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, FileText, FolderCheck, Landmark, LocateFixed, Minus, Plus } from 'lucide-react';
import './collage.css';

// The scene is authored in reference pixels: america.gov's #upcoming-features
// measured at a 1470px viewport, shifted 120px right so the left-cropped cards
// sit inside the canvas. Positions live in collage.css; scale and initial pan
// follow the reference's measured viewport behaviour.
const CANVAS_ORIGIN = 120;
const LOGO_SETS = [
  [['pm-jay', 'PM-JAY'], ['pm-jan-dhan', 'PM Jan Dhan Yojana'], ['rti', 'Right to Information']],
  [['pmay-g', 'PMAY-G'], ['umang', 'UMANG'], ['digilocker', 'DigiLocker']],
  [['digital-india', 'Digital India'], ['pm-ujjwala', 'PM Ujjwala Yojana'], ['skill-india', 'Skill India']],
];
const ROUND_LOGOS = new Set(['pm-jay', 'pm-jan-dhan', 'pmay-g']);
const STATES = [['Karnataka', 'KA'], ['Maharashtra', 'MH'], ['Tamil Nadu', 'TN']];

function sceneScale(width) {
  if (width < 700) return .894;
  if (width <= 1470) return Math.max(.6, .648 + (width - 768) * .000501);
  return 1 + (width - 1470) * .000391;
}

function Segmented({ options, value, onChange, label }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(option => <button key={option} className={value === option ? 'on' : ''} aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>)}</div>;
}

function IllustrativeMap({ zoom }) {
  return <svg className="map-art" viewBox="0 0 600 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ transform: `scale(${zoom})` }}>
    <rect width="600" height="380" fill="#e5efdc"/>
    <path d="M0 0h190c-20 50 10 90-30 130S40 150 0 210z" fill="#d3e6c6"/>
    <path d="M330 0h270v170c-60-10-90 30-150 10s-60-80-120-90z" fill="#cfe4c1"/>
    <path d="M250 250c60-30 130 10 190-20s110 0 160 20v150H230c-20-60-10-120 20-150z" fill="#d6e8ca"/>
    <path d="M60 20c30 10 40 40 20 60s-50 10-60-20 10-50 40-40zM470 40c30 0 50 20 40 45s-55 20-65-5 0-40 25-40z" fill="#bcd9ad"/>
    <path d="M520 170c40-10 75 20 80 60v40c-40 10-90-10-100-50s-10-45 20-50z" fill="#b3d7ea"/>
    <path d="M610 120C520 150 470 110 420 160S380 270 300 300 180 330 120 400" fill="none" stroke="#b3d7ea" strokeWidth="11" strokeLinecap="round"/>
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-10 95L120 110 240 160 380 140 610 210M150-10l30 120 20 110-40 180M-10 300l150-60 140 40 160-60 170 20M395-10l-15 150 40 110 50 140" stroke="#fff" strokeWidth="7"/>
      <path d="M250 -10l-20 90 40 70 10 100-30 140M60 200l100 10 70-50" stroke="#fff" strokeWidth="4"/>
      <path d="M-10 95L120 110 240 160 380 140 610 210" stroke="#f1d58a" strokeWidth="3.4"/>
      <path d="M150-10l30 120 20 110-40 180M-10 300l150-60 140 40 160-60 170 20M395-10l-15 150 40 110 50 140" stroke="#e5ddc0" strokeWidth="1.2"/>
    </g>
    <g fill="#9bb38f" opacity=".5">{[[40, 250], [90, 320], [300, 60], [540, 320], [480, 110], [210, 300]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.4"/>)}</g>
  </svg>;
}

function Guilloche() {
  return <svg className="guilloche" viewBox="0 0 270 220" preserveAspectRatio="none" aria-hidden="true">
    {Array.from({ length: 16 }, (_, i) => <path key={i} d={`M0 ${14 + i * 13} C 45 ${i * 13} 90 ${28 + i * 13} 135 ${14 + i * 13} S 225 ${i * 13} 270 ${14 + i * 13}`} fill="none" stroke={i % 2 ? '#c8c3e6' : '#d6d1ec'} strokeWidth=".7"/>)}
    {Array.from({ length: 10 }, (_, i) => <ellipse key={i} cx="210" cy="118" rx={22 + i * 6} ry={14 + i * 4} fill="none" stroke="#cbc6e8" strokeWidth=".5" transform={`rotate(${i * 8} 210 118)`}/>)}
  </svg>;
}

export default function ServiceCollage({ hideComposer = false }) {
  const [state, setState] = useState('Karnataka');
  const [issue, setIssue] = useState('Short quantity');
  const [zoom, setZoom] = useState(1);
  const [authority, setAuthority] = useState('Central');
  const [stage, setStage] = useState('Closed');
  const [showRoute, setShowRoute] = useState(false);
  const [prepared, setPrepared] = useState([true, true, false, false]);
  const [business, setBusiness] = useState('New');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [ask, setAsk] = useState('');
  const [askStatus, setAskStatus] = useState('');
  const [scale, setScale] = useState(1);
  const [logoSet, setLogoSet] = useState(0);
  const [arrowPressed, setArrowPressed] = useState(false);
  const [printChecked, setPrintChecked] = useState(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const pressArrow = () => { setArrowPressed(true); later(() => setArrowPressed(false), 650); };
  const animatePrint = () => { if (printChecked) return; setPrintChecked(true); later(() => setPrintChecked(false), 2200); };
  const sectionRef = useRef(null);
  const sceneRef = useRef(null);
  const userPanned = useRef(false);

  useLayoutEffect(() => {
    const fit = () => {
      const width = sceneRef.current?.clientWidth || window.innerWidth;
      const s = sceneScale(width);
      setScale(s);
      if (!userPanned.current && sceneRef.current) {
        const centre = (width < 700 ? 596 : 735) + CANVAS_ORIGIN;
        sceneRef.current.scrollLeft = centre * s - width / 2;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => { setShowRoute(false); }, [authority, stage]);

  const reviewedRoute = authority === 'Central' && stage === 'Closed';
  const togglePrepared = i => setPrepared(values => values.map((v, n) => n === i ? !v : v));
  const stepNotes = ['Clarify service, place and stage', 'Prepare from a reviewed guide', 'Hand off before any submission'];
  const explore = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sceneRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    sceneRef.current?.focus({ preventScroll: true });
  };

  return <section className="service-section" ref={sectionRef} aria-labelledby="services-title" style={{ '--s': scale }}>
    <div className="service-intro">
      <h2 id="services-title" className="manifesto">
        HobbyLM <span className="badge-slot"><button className={`arrow-badge ${arrowPressed ? 'pressed' : ''}`} aria-label="Press the arrow" onClick={pressArrow}><ArrowRight strokeWidth={2.4}/></button></span> explores clearer next steps using <span className="badge-slot seals"><button className="seal-button" aria-label={`Cycle official service logos. Showing ${LOGO_SETS[logoSet].map(([, name]) => name).join(', ')}`} onClick={() => setLogoSet(i => (i + 1) % LOGO_SETS.length)}>{LOGO_SETS[logoSet].map(([file, name], i) => <span key={`${logoSet}-${file}`} className={`logo-seal seal-${i} ${ROUND_LOGOS.has(file) ? 'round' : ''}`} style={{ animationDelay: `${i * 70}ms` }}><img src={`/logos/${file}.svg`} alt="" title={name}/></span>)}</button></span> official Indian sources. It’s an independent experiment. Don’t share <span className="badge-slot print"><button className={`print-button ${printChecked ? 'checked' : ''}`} aria-label="Animate the fingerprint" onClick={animatePrint}><svg viewBox="0 0 48 48" className="fingerprint" aria-hidden="true"><g fill="none" stroke="#e23a8f" strokeWidth="1.6" strokeLinecap="round">{[6, 9.5, 13, 16.5, 20].map((r, i) => <path key={r} pathLength="1" style={{ animationDelay: `${i * 60}ms` }} d={`M${24 - r} ${26 + i * .6}a${r} ${r + 1} 0 0 1 ${r * 2} 0${i % 2 ? `v${3 + i}` : ''}`}/>)}<path pathLength="1" d="M24 26v9M20.5 27v7.5c0 2 .6 4 1.6 5.5M27.5 27v6c0 3-.8 5.6-2 7.6M17 28.5v4c0 3 .9 6 2.6 8.3M31 28v3.5c0 4-1 7.4-3 10"/></g></svg><svg viewBox="0 0 48 48" className="print-check" aria-hidden="true"><path d="M14 25l7 7 13-15" fill="none" stroke="#22b357" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" pathLength="1"/></svg></button></span> personal details here.
      </h2>
      <button className="explore-button" onClick={explore}>Explore the service previews</button>
      <p className="concept-note">Explore the service concepts. Live model output is available through the experimental toggle.</p>
    </div>

    <div className="service-scene" ref={sceneRef} tabIndex={-1} aria-label="Service previews" onPointerDown={() => { userPanned.current = true; }} onWheel={e => { if (Math.abs(e.deltaX) > 0) userPanned.current = true; }}>
      <div className="scene-sizer">
        <div className="scene-canvas">

          <article className="card ration-card" aria-labelledby="ration-title">
            <h3 id="ration-title">Ration service help in {state}</h3>
            <div className="map-frame">
              <IllustrativeMap zoom={zoom}/>
              <span className="map-pin" aria-hidden="true"/>
              <div className="map-list">
                {STATES.map(([name, code]) => <div className="map-row" key={name}>
                  <span className="state-tile" aria-hidden="true">{code}</span>
                  <span className="row-text"><strong>{name}</strong><small>{state === name ? `${issue} · route preview` : 'State-specific route'}</small></span>
                  <button className={state === name ? 'chip chosen' : 'chip'} aria-pressed={state === name} aria-label={`Select ${name}`} onClick={() => setState(name)}>{state === name ? <Check size={12} strokeWidth={3}/> : 'Select'}</button>
                </div>)}
                <Segmented label="Ration issue preview" options={['Short quantity', 'Card update']} value={issue} onChange={setIssue}/>
              </div>
              <a className="map-button map-expand" href="https://nfsa.gov.in/portal/apply" target="_blank" rel="noopener noreferrer" aria-label="About ration-card routes on NFSA (official site)" title="About ration-card routes (NFSA)"><ArrowUpRight size={15}/></a>
              <button className="map-button map-locate" aria-label="Reset map illustration" onClick={() => setZoom(1)}><LocateFixed size={15}/></button>
              <div className="map-zoom"><button aria-label="Zoom map illustration in" onClick={() => setZoom(v => Math.min(1.8, v + .2))}><Plus size={14}/></button><button aria-label="Zoom map illustration out" onClick={() => setZoom(v => Math.max(1, v - .2))}><Minus size={14}/></button></div>
              <span className="map-caption">Illustrative map · not office locations</span>
            </div>
            <p className="sr-only" role="status">{state}, {issue}. State-specific guidance needs review.</p>
          </article>

          <article className="card rti-card" aria-labelledby="rti-title">
            <h3 id="rti-title">Waiting for an RTI reply?</h3>
            <div className="rti-document" role="img" aria-label="Illustrative first-appeal preparation sheet. Not a form.">
              <Guilloche/>
              <div className="doc-top"><span>RIGHT TO INFORMATION ACT, 2005</span><span>PREPARATION · FIRST APPEAL</span></div>
              <div className="doc-body">
                <div className="doc-receipt"><i/><i/><i/><i/><span className="doc-stamp">RTI</span></div>
                <dl>
                  <dt>Original request</dt><dd>Reg. no. ____________</dd>
                  <dt>Public authority</dt><dd>Name &amp; address ______</dd>
                  <dt>Date of request</dt><dd>__ / __ / ____</dd>
                  <dt>Response, if received</dt><dd>Keep ready</dd>
                </dl>
              </div>
              <span className="doc-watermark">ILLUSTRATIVE</span>
              <div className="doc-mrz">RTI&lt;FIRST&lt;APPEAL&lt;&lt;PREPARATION&lt;PREVIEW&lt;&lt;&lt;&lt;&lt;&lt;<br/>NOT&lt;A&lt;FORM&lt;&lt;KEEP&lt;REQUEST&lt;AND&lt;RESPONSE&lt;&lt;</div>
            </div>
            <a className="pill-action" href="https://rtionline.gov.in/" target="_blank" rel="noopener noreferrer">Open Central RTI portal</a>
          </article>

          <article className="card complaint-card" aria-labelledby="complaint-title">
            <h3 id="complaint-title">Complaint closed?</h3>
            <label className="field"><span className="sr-only">Complaint description preview</span><input defaultValue="Closed without resolution"/></label>
            <div className="inner-panel">
              <div className="item-row"><span className="quote-tile" aria-hidden="true">“</span><span>“It says resolved. But nothing changed.”</span><span className="tag">Example</span></div>
              <div className="option-row"><span>Authority</span><Segmented label="Complaint authority preview" options={['Central', 'State / UT']} value={authority} onChange={setAuthority}/></div>
              <div className="option-row"><span>Stage</span><Segmented label="Complaint stage preview" options={['Closed', 'Pending']} value={stage} onChange={setStage}/></div>
              <div className="option-row"><span>Route</span><div className="segmented single"><span className="on">{reviewedRoute ? 'CPGRAMS feedback · preview' : 'Needs its own reviewed route'}</span></div></div>
            </div>
            <div className="action-row">
              <p role="status">{showRoute ? (reviewedRoute ? 'The guide would check the closure and feedback stage first.' : 'No procedural guidance for this selection yet.') : 'Source-led. No promise of resolution.'}</p>
              <button className="pill-action" aria-expanded={showRoute} onClick={() => setShowRoute(v => !v)}>Preview the next step</button>
            </div>
          </article>

          <div className="udyam-cover" aria-labelledby="udyam-title" role="group">
            <div className="portal-head">
                            <div className="portal-brand"><span className="msme-mark" aria-hidden="true"><i/><i/><i/></span><span>udyamregistration.gov.in<small>Preparation preview · not the official portal</small></span></div>
              <h3 id="udyam-title" className="portal-title">UDYAM <b>REGISTRATION</b></h3>
              <nav className="portal-nav" aria-hidden="true"><span>Home</span><span>NIC Code</span><span>Useful Documents</span><span>Print / Verify</span></nav>
              <span className="tricolour" aria-hidden="true"/>
            </div>
            <div className="portal-sheet">
              <p className="sheet-kicker">Register your business</p>
              <div className="portal-options" role="group" aria-label="Udyam journey preview">
                <button aria-pressed={business === 'New'} className={business === 'New' ? 'on' : ''} onClick={() => setBusiness('New')}><span className="opt-dot" aria-hidden="true"/>For new entrepreneurs not yet registered as MSME</button>
                <button aria-pressed={business === 'Existing'} className={business === 'Existing' ? 'on' : ''} onClick={() => setBusiness('Existing')}><span className="opt-dot" aria-hidden="true"/>For those already registered as UAM or Udyam</button>
              </div>
              <div className="sheet-lines" aria-hidden="true"><i/><i/><i/></div>
              <span className="cover-foot">Free on the official portal · No identity details here</span>
            </div>
          </div>

          <a className="udyam-pill" href="https://udyamregistration.gov.in/" target="_blank" rel="noopener noreferrer"><span className="pill-icon" aria-hidden="true"><Landmark size={18} strokeWidth={1.8}/></span>Udyam portal<span className="sr-only"> ({business === 'New' ? 'new registration' : 'existing record'} options, official site)</span></a>

          <article className="card next-card" aria-labelledby="next-title">
            <div className="next-head"><span className="mini-booklet" aria-hidden="true"/><div><h3 id="next-title">Your next step</h3><p role="status">{stepNotes[step]}</p></div></div>
            <div className="tracker" role="group" aria-label="Illustrative guide progress">
              {['Understand', 'Prepare', 'Continue'].map((name, i) => <button key={name} className={`${i < step ? 'done' : ''} ${i === step ? 'current' : ''}`} aria-pressed={i === step} onClick={() => setStep(i)}>
                <span className="node">{i < step && <Check size={12} strokeWidth={3.2}/>}</span><span className="label">{name}</span>
              </button>)}
            </div>
          </article>

          <article className="card scholarship-card" aria-labelledby="scholarship-title">
            <h3 id="scholarship-title">Scholarship preparation</h3>
            <div className="inner-panel checklist">
              {[['Identify the scheme', BookOpen], ['Check the academic year', CalendarDays], ['Read official requirements', FileText], ['Keep documents ready', FolderCheck]].map(([text, Icon], i) => <label className="check-row" key={text}>
                <span className="seal" aria-hidden="true"><Icon size={15} strokeWidth={1.7}/></span>
                <span>{text}</span>
                <input type="checkbox" checked={prepared[i]} onChange={() => togglePrepared(i)}/>
                <span className="box" aria-hidden="true">{prepared[i] && <Check size={11} strokeWidth={3.4}/>}</span>
              </label>)}
            </div>
            <a className="pill-action" href="https://scholarships.gov.in/" target="_blank" rel="noopener noreferrer">National Scholarship Portal</a>
          </article>

          <a className="card photo-tile" href="https://scholarships.gov.in/" target="_blank" rel="noopener noreferrer">
            <img src="/images/phule.webp" alt="Imaginative illustration of Jyotirao and Savitribai Phule"/>
            <span className="tile-link">Education &amp; access, scholarship preparation</span>
            <span className="tile-meta">A little preparation. A clearer place to start.</span>
          </a>

          <div className={`evidence-zone ${evidenceOpen ? 'open' : ''}`}>
            <button className="evidence-toggle" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen(v => !v)}>
              {evidenceOpen ? <span className="evidence-detail"><q>CPGRAMS describes feedback and appeal options when a complainant is dissatisfied.</q><small>Paraphrase · human review required before guidance</small></span> : 'Evidence behind the answer'}
            </button>
            <a className="source-chip" href="https://pgportal.gov.in/" target="_blank" rel="noopener noreferrer"><span className="source-tile" aria-hidden="true"><b>GOV</b></span><span className="source-name">pgportal.gov.in</span><span className="sr-only"> (CPGRAMS official source)</span></a>
            <svg className="cursor" viewBox="0 0 24 30" aria-hidden="true"><path d="M2 2l19 18h-9l5 8-4 2-5-8-6 6z" fill="#000c1f" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/></svg>
          </div>

        </div>
      </div>
    </div>

    {!hideComposer && <form className="ask-bar" onSubmit={e => { e.preventDefault(); setAskStatus('This is an interface preview. Your question has not been sent or saved.'); }}>
      {askStatus && <p className="ask-status" role="status">{askStatus}</p>}
      <label className="sr-only" htmlFor="scene-question">Describe what you need</label>
      <input id="scene-question" value={ask} placeholder="Describe what you need…" autoComplete="off" maxLength={500} onChange={e => { setAsk(e.target.value); setAskStatus(''); }}/>
      <button type="submit" aria-label="Ask a question"><ArrowRight size={20}/></button>
    </form>}
  </section>;
}
