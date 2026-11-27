import React, { useEffect, useState } from 'react';

let mod = null;
const load = () => (mod ??= import('./miniSearch'));

// Plan B: the Mini loads automatically after first paint, for everyone, no button.
// "ready" means the model runs and questions are answered; saving the files for offline
// use settles separately and is reported on its own (never blocks ready).
export function useMiniMode(enabled) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [offline, setOffline] = useState('idle'); // idle | saving | saved | failed
  const [error, setError] = useState('');
  const [search, setSearch] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('loading');
    setOffline('saving');
    load().then(async mod => {
      await mod.loadMiniModel();
      if (cancelled) return;
      setSearch(() => mod.miniSearch);
      setStatus('ready');
      mod.shellReady()
        .then(() => { if (!cancelled) setOffline('saved'); })
        .catch(() => { if (!cancelled) setOffline('failed'); });
    }).catch(e => { if (!cancelled) { setError(e.message || 'Smart search could not start.'); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [enabled]);

  return { status, offline, error, search };
}

export default function MiniStatus({ mini }) {
  if (mini.status === 'loading') {
    return <div className="smart-row" role="status">Smart search loading (33 MB, once)…</div>;
  }
  if (mini.status === 'error') {
    return <div className="smart-row" role="status">Smart search could not start on this device. Keyword search still works.</div>;
  }
  if (mini.status === 'ready') {
    return <div className="smart-row ready" role="status">Smart search ready · runs on your device
      {mini.offline === 'failed' && <span className="smart-warn"> — could not save this page for offline use.</span>}
    </div>;
  }
  return null;
}
