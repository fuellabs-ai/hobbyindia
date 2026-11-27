import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
// Fallback check: a slow (5 s) or unreachable /api/search must fall back to keyword search within ~2 s.
import { build } from 'esbuild'; import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'fb-')), 's.mjs');
await build({ entryPoints: [new URL('../src/search.js', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const s = await import(pathToFileURL(out));
const slow = (url, opts) => new Promise((res, rej) => { const t = setTimeout(() => res({ ok: true, json: async () => ({}) }), 5000); opts.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); });
let r = await s.searchQuestion('pension not credited', { fetchImpl: slow });
console.log('slow server ->', r.source, r.fallbackReason, r.ms + 'ms', r.results[0].id);
r = await s.searchQuestion('pension not credited', { endpoint: 'http://127.0.0.1:1/api/search' });
console.log('server down ->', r.source, r.fallbackReason, r.ms + 'ms', r.results[0].id);
