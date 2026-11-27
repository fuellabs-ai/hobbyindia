// Plan B (local-first): HobbyLM-Embed-Mini (int8) runs in every visitor's browser.
// Same pipeline as the server (redact -> normalize -> emergency -> script guard -> "query: "
// -> embed -> best row per card -> hybrid passages), but nothing is sent anywhere.
// Loaded automatically after first paint; keyword search answers until it is ready.
// The 140M teacher's vectors (data/index/) are never used here - only data/index-mini/.
import * as ort from 'onnxruntime-web/wasm';
import { AutoTokenizer, env } from '@huggingface/transformers';
import indexMeta from '../data/index-mini/index.json';
import vectorsUrl from '../data/index-mini/vectors.f32?url';
import passagesUrl from '../data/index-mini/passages.f32?url';
import config from '../data/search_config.json';
import { cards, searchMetadata } from './search';
import { chunks, passageDim, departmentByCard, rankPassages, passageResponse } from './passageSearch';

export const MODEL_URL = import.meta.env.VITE_MINI_MODEL_URL || '/mini-model/hobbylm-embed-mini.int8.onnx';
// Everything fetched on first visit: model + tokenizer + wasm + vectors ≈ 33 MB beyond the app itself.
export const MODEL_MB = 33;
const TOKENIZER_DIR = MODEL_URL.replace(/[^/]*$/, ''); // '/mini-model/' locally, the HF resolve dir in production
const REMOTE_TOKENIZER = /^https?:\/\//.test(TOKENIZER_DIR);
const MAX_LEN = 256; // hard limit of the Mini (tokenizer_config's 512 is wrong) - scripts/build_mini_index.mjs
// Model, tokenizer, wasm and vectors move together: the whole cache is named after the model
// hash recorded in data/index-mini/index.json. public/sw.js computes the same name.
export const CACHE_NAME = `hobbylm-mini-${indexMeta.onnx_sha256.slice(0, 16)}`;
const ONNX_SHA = indexMeta.onnx_sha256;

ort.env.wasm.wasmPaths = '/ort/';
// Single-thread WASM, always: the embed costs ~5-10 ms even alone, and threads would spawn a
// worker that fetches its own 14.5 MB copy of the wasm (first-visit download doubles).
// Works on phones; COOP/COEP headers stay for the Plan C private mode.
ort.env.wasm.numThreads = 1;
// The tokenizer files load by explicit URL when the model lives on Hugging Face: with
// allowRemoteModels the 'tokenizer' name would wrongly resolve to huggingface.co/tokenizer/.
env.allowRemoteModels = REMOTE_TOKENIZER;
env.allowLocalModels = !REMOTE_TOKENIZER;
env.localModelPath = TOKENIZER_DIR;

let state = null; // { session, tokenizer, vecs, passageVecs, rowCard, rowMatches }
let shellPromise = null; // set once the model is ready; settles when offline saving finishes

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchModel(onProgress) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(MODEL_URL);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    // Cached weights are only used if they are exactly the ones the index was built with.
    if (await sha256Hex(buffer) === ONNX_SHA) { onProgress?.(1); return { buffer, fromCache: true }; }
    await cache.delete(MODEL_URL); // stale or corrupt copy: start over
  }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || MODEL_MB * 1e6;
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProgress?.(Math.min(got / total, 0.99));
  }
  const buffer = await new Blob(parts).arrayBuffer();
  // Never cache weights that are not the ones the index was built with.
  if (await sha256Hex(buffer) !== ONNX_SHA) throw new Error('Downloaded model does not match its index (sha256)');
  return { buffer, fromCache: false };
}

// Keep the page itself, the runtime, the tokenizer and the vectors for offline reloads.
// Runs in the background after "ready"; failures surface through shellReady.
async function cacheAppShell() {
  if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {});
  const cache = await caches.open(CACHE_NAME);
  const urls = new Set(['/', '/ort/ort-wasm-simd-threaded.wasm', '/ort/ort-wasm-simd-threaded.mjs',
    `${TOKENIZER_DIR}tokenizer.json`, `${TOKENIZER_DIR}tokenizer_config.json`]);
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name);
    if (u.origin === location.origin && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/models/')) urls.add(u.pathname);
  }
  let saved = 0, failed = 0;
  await Promise.all([...urls].map(async u => {
    if (await cache.match(u)) { saved++; return; }
    const r = await fetch(u).catch(() => null);
    // Read fully, then save: saving large files straight from the stream fails ("Cache.put() encountered a network error").
    if (r?.ok) { await r.arrayBuffer().then(b => cache.put(u, new Response(b, { headers: { 'Content-Type': r.headers.get('Content-Type') || '' } }))).catch(() => { failed++; }); saved++; } else failed++;
  }));
  // Old caches (previous model versions, the old shared name) only waste space now.
  for (const name of await caches.keys()) if (name.startsWith('hobbylm-') && name !== CACHE_NAME) await caches.delete(name);
  if (failed > 0) throw new Error(`${failed} file${failed > 1 ? 's' : ''} could not be saved for offline use`);
  return `${saved} files saved for offline use`;
}

export async function loadMiniModel(onProgress) {
  if (state) return;
  const cache = await caches.open(CACHE_NAME);
  const [{ buffer, fromCache }, tokenizer, vecBuf, passageBuf] = await Promise.all([
    fetchModel(onProgress),
    REMOTE_TOKENIZER ? AutoTokenizer.from_pretrained(TOKENIZER_DIR) : AutoTokenizer.from_pretrained('tokenizer'),
    fetch(vectorsUrl).then(r => { if (!r.ok) throw new Error('card vectors unavailable'); return r.arrayBuffer(); }),
    fetch(passagesUrl).then(r => { if (!r.ok) throw new Error('passage vectors unavailable'); return r.arrayBuffer(); }),
  ]);
  let readySession;
  try {
    // Same tokenizer check as scripts/build_mini_index.mjs: the index is useless if tokenization differs.
    const check = Array.from(tokenizer(['query: hello world']).input_ids.data, Number);
    if (JSON.stringify(check) !== JSON.stringify([22766, 25, 23748, 995, 50256])) throw new Error(`tokenizer mismatch: ${check}`);
    if (passageDim !== indexMeta.dim || vecBuf.byteLength !== indexMeta.rows.length * indexMeta.dim * 4 || passageBuf.byteLength !== chunks.length * passageDim * 4) {
      throw new Error('Search vectors do not match their metadata; reload the application.');
    }
    const session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
    // One real forward pass before the weights are trusted (or cached).
    const probe = tokenizer(['query: hello world'], { truncation: true, max_length: MAX_LEN });
    const out = await session.run({
      input_ids: new ort.Tensor('int64', probe.input_ids.data, probe.input_ids.dims),
      attention_mask: new ort.Tensor('int64', probe.attention_mask.data, probe.attention_mask.dims),
    });
    if (out.embedding?.dims?.[1] !== indexMeta.dim) throw new Error(`model output dim ${out.embedding?.dims?.[1]} != ${indexMeta.dim}`);
    readySession = session;
  } catch (error) {
    // Never keep weights that did not validate: the next load downloads them again.
    await cache.delete(MODEL_URL).catch(() => {});
    throw error;
  }
  if (!fromCache) await cache.put(MODEL_URL, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  const col = Object.fromEntries(cards.map((c, i) => [c.id, i]));
  const offsets = Object.fromEntries(cards.map(c => [c.id, 0]));
  const rowMatches = indexMeta.rows.map(r => ({ via: r.kind,
    matched: r.kind === 'card' ? cards[col[r.card]].title : cards[col[r.card]].examples[offsets[r.card]++] }));
  state = { session: readySession, tokenizer, vecs: new Float32Array(vecBuf), passageVecs: new Float32Array(passageBuf),
    rowCard: indexMeta.rows.map(r => col[r.card]), rowMatches };
  // Offline saving must not delay "ready"; MiniMode reports how it settles.
  shellPromise = cacheAppShell();
}

export const miniReady = () => Boolean(state);
// Resolves when the app shell is saved for offline use; rejects with the reason if it failed.
export const shellReady = () => shellPromise ?? Promise.reject(new Error('Smart search is not ready'));

async function embedQuery(text) {
  const enc = state.tokenizer(['query: ' + text], { truncation: true, max_length: MAX_LEN });
  const out = await state.session.run({
    input_ids: new ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims),
    attention_mask: new ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims),
  });
  const v = out.embedding.data;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
}

export async function miniSearch(raw) {
  const started = performance.now();
  const metadata = searchMetadata(raw, 'local');
  if (metadata.reason || !metadata.cleaned) return { ...metadata, ms: 0 };
  if (!state) throw new Error('Smart search is not ready');
  const embedStarted = performance.now();
  const q = await embedQuery(metadata.cleaned);
  const embed = Math.round(performance.now() - embedStarted);
  const dim = indexMeta.dim, best = new Array(cards.length).fill(-1);
  const winners = new Array(cards.length).fill(0);
  for (let r = 0; r < state.rowCard.length; r++) {
    let s = 0; const off = r * dim;
    for (let i = 0; i < dim; i++) s += state.vecs[off + i] * q[i];
    const c = state.rowCard[r]; if (s > best[c]) { best[c] = s; winners[c] = r; }
  }
  // Sort unrounded scores, just like the server; rounding must not change ties.
  const order = best.map((_, i) => i).sort((a, b) => best[b] - best[a] || a - b).slice(0, config.top_k);
  const results = order.map(i => ({ id: cards[i].id, score: Math.round(best[i] * 1e4) / 1e4, ...state.rowMatches[winners[i]] }));
  const ranked = rankPassages(metadata.cleaned, q, state.passageVecs, departmentByCard[results[0]?.id]);
  const total = Math.round(performance.now() - started);
  return { ...metadata, covered: Boolean(results.length) && results[0].score >= (config.mini_threshold ?? config.threshold), results,
    compared: indexMeta.rows.length, ...passageResponse(ranked), timing_ms: { embed, total }, ms: total };
}
