import React, { useEffect, useState } from 'react';
import { Laptop, Lock } from 'lucide-react';

export const SEARCH_MODE = import.meta.env.VITE_SEARCH_MODE || 'local'; // 'local' (Plan B) | 'server' (Plan C)
export const PRIVATE_COPY = 'Runs on your computer. Your question isn’t sent anywhere. Works offline after the first load.';
const FLAG = 'hobbylm-private-mode'; // only "on" or absent; no question data is ever stored

let mod = null;
const load = () => (mod ??= import('./privateSearch'));

// Exposes the private searcher to the page once it's ready (or null).
// Plan C only: never starts in local mode, even with a leftover "on" flag.
export function usePrivateMode() {
  const [status, setStatus] = useState('off'); // off | confirm | loading | on | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(null);

  async function start() {
    setStatus('loading'); setError(''); setProgress(0);
    try {
      const m = await load();
      await m.loadPrivateModel(setProgress);
      localStorage.setItem(FLAG, 'on');
      setSearch(() => m.privateSearch);
      setStatus('on');
    } catch (e) {
      setError(e.message || 'Private mode could not start.'); setStatus('error');
    }
  }
  function stop() { localStorage.removeItem(FLAG); setSearch(null); setStatus('off'); }

  // Turned on before (and cached)? Start again on load, which also works offline.
  useEffect(() => {
    if (SEARCH_MODE !== 'server' || localStorage.getItem(FLAG) !== 'on') return;
    load().then(m => m.isModelCached()).then(cached => cached ? start() : localStorage.removeItem(FLAG)).catch(() => {});
  }, []);

  return { status, setStatus, progress, error, search, start, stop };
}

export default function PrivateModeControl({ pm }) {
  const { status, setStatus, progress, error, start, stop } = pm;
  if (SEARCH_MODE !== 'server') return null; // local mode: everything already runs on the device
  if (status === 'on') return <div className="private-row on"><Lock size={15} aria-hidden="true"/><span><b>Private mode is on.</b> {PRIVATE_COPY}</span><button onClick={stop}>Turn off</button></div>;
  if (status === 'loading') return <div className="private-row"><span>Downloading HobbyLM-Embed to this computer… {Math.round(progress * 100)}%</span><progress value={progress} max="1" aria-label="Private mode download"/></div>;
  if (status === 'confirm') return <div className="private-row confirm" role="dialog" aria-label="Private mode">
    <p><b>Private mode, runs on your computer.</b> {PRIVATE_COPY}</p>
    <p>One-time download: <b>560 MB</b>. Best on a laptop or desktop with Wi-Fi.</p>
    <div><button className="primary" onClick={start}>Download and turn on</button><button onClick={() => setStatus('off')}>Cancel</button></div>
  </div>;
  return <div className="private-row">
    <button className="private-button" onClick={() => setStatus('confirm')}><Laptop size={16} aria-hidden="true"/>Private mode, runs on your computer</button>
    {status === 'error' && <span className="private-error" role="alert">{error}</span>}
  </div>;
}
