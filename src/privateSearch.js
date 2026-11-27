// Private mode: HobbyLM-Embed runs in this browser. The question never leaves the device.
// Same pipeline as the server (redact -> normalize -> "query: " -> embed -> best row per card),
// using the fp32 ONNX export that matched the Python model exactly (cos 1.0, 20/20 top cards).
// Loaded only when someone turns private mode on, so the normal page stays light.
import * as ort from 'onnxruntime-web/wasm';
import { AutoTokenizer, env } from '@huggingface/transformers';
import indexMeta from '../data/index/index.json';
import vectorsUrl from '../data/index/vectors.f32?url';
import passagesUrl from '../data/index/passages.f32?url';
import config from '../data/search_config.json';
import { cards, searchMetadata } from './search';
import { chunks, passageDim, departmentByCard, rankPassages, passageResponse } from './passageSearch';

export const MODEL_URL = import.meta.env.VITE_PRIVATE_MODEL_URL || '/models/hobbylm_embed_140m.fp32.onnx';
export const MODEL_MB = 560;
const CACHE = 'hobbylm-private-v1';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/private-model/';

let state = null; // { session, tokenizer, vecs, rowCard }

export async function isModelCached() {
  return Boolean(await (await caches.open(CACHE)).match(MODEL_URL));
}

async function modelBuffer(onProgress) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(MODEL_URL);
  if (hit) { onProgress?.(1); return hit.arrayBuffer(); }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || MODEL_MB * 1e6;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress?.(Math.min(got / total, 0.99));
  }
  const blob = new Blob(chunks);
  await cache.put(MODEL_URL, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream' } }));
  onProgress?.(1);
  return blob.arrayBuffer();
}

// Keep the page itself, the runtime and the tokenizer for offline reloads.
async function cacheAppShell() {
  if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {});
  const cache = await caches.open(CACHE);
  const urls = new Set(['/', '/ort/ort-wasm-simd-threaded.wasm', '/ort/ort-wasm-simd-threaded.mjs',
    '/private-model/tokenizer/tokenizer.json', '/private-model/tokenizer/tokenizer_config.json', '/private-model/tokenizer/config.json']);
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name);
    if (u.origin === location.origin && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/models/')) urls.add(u.pathname);
  }
  await Promise.all([...urls].map(async u => { if (!(await cache.match(u))) { const r = await fetch(u).catch(() => null); if (r?.ok) await cache.put(u, r); } }));
}

export async function loadPrivateModel(onProgress) {
  if (state) return;
  const [buffer, tokenizer, vecBuf, passageBuf] = await Promise.all([
    modelBuffer(onProgress),
    AutoTokenizer.from_pretrained('tokenizer'),
    fetch(vectorsUrl).then(r => { if (!r.ok) throw new Error('card vectors unavailable'); return r.arrayBuffer(); }),
    fetch(passagesUrl).then(r => { if (!r.ok) throw new Error('passage vectors unavailable'); return r.arrayBuffer(); }),
  ]);
  if (passageDim !== indexMeta.dim || vecBuf.byteLength !== indexMeta.rows.length * indexMeta.dim * 4 || passageBuf.byteLength !== chunks.length * passageDim * 4) {
    throw new Error('Search vectors do not match their metadata; reload the application.');
  }
  const session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
  const col = Object.fromEntries(cards.map((c, i) => [c.id, i]));
  const offsets = Object.fromEntries(cards.map(c => [c.id, 0]));
  const rowMatches = indexMeta.rows.map(r => ({ via: r.kind,
    matched: r.kind === 'card' ? cards[col[r.card]].title : cards[col[r.card]].examples[offsets[r.card]++] }));
  state = { session, tokenizer, vecs: new Float32Array(vecBuf), passageVecs: new Float32Array(passageBuf),
    rowCard: indexMeta.rows.map(r => col[r.card]), rowMatches };
  await cacheAppShell();
}

export const privateReady = () => Boolean(state);

async function embedQuery(text) {
  const enc = state.tokenizer(['query: ' + text]);
  const out = await state.session.run({
    input_ids: new ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims),
    attention_mask: new ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims),
  });
  const v = out.embedding.data;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Float32Array.from(v, x => x / n);
}

export async function privateSearch(raw) {
  const started = performance.now();
  const metadata = searchMetadata(raw, 'private');
  if (metadata.reason || !metadata.cleaned) return { ...metadata, ms: 0 };
  if (!state) throw new Error('Private model is not ready');
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
  return { ...metadata, covered: Boolean(results.length) && results[0].score >= config.threshold, results,
    compared: indexMeta.rows.length, ...passageResponse(ranked), timing_ms: { embed, total }, ms: total };
}
