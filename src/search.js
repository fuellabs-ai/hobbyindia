// Question search. Server: /api/search (HobbyLM-Embed). If it fails or takes longer than
// 2 s, a keyword search over the same static cards runs in the browser, so a question
// always gets an answer from the card set and nothing is ever generated.
// normalize / redact / isEmergency must stay identical to server/search_core.py.
import servicesData from '../data/services.json';
import emergencyData from '../data/emergency.json';
import flowData from '../data/flows.json';
import config from '../data/search_config.json';
import { keywordPassages } from './passageSearch';
import { normalize, redact, isEmergency, indicScript } from './searchText';
export { normalize, redact, isEmergency, indicScript } from './searchText';

export const cards = servicesData.cards;
export const cardById = Object.fromEntries(cards.map(c => [c.id, c]));
export const emergencyContacts = emergencyData.contacts;
export const API_TIMEOUT_MS = 2000;
// Where the search server lives. Empty = same origin (local dev / single-box). On Vercel: the HF Space URL.
export const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

// Outgoing links: https only, and only to hosts that appear in our data files.
const flowLinks = flowData.flows.flatMap(f => Object.values(f.nodes).map(n => n.link?.url).filter(Boolean));
const ALLOWED_HOSTS = new Set([...cards.map(c => c.official_url), ...emergencyData.contacts.map(c => c.official_url), ...flowLinks].map(u => new URL(u).hostname));
export function safeUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? u.href : undefined; } catch { return undefined; }
}

export function searchMetadata(raw, source) {
  const [text, removed] = redact(raw);
  const cleaned = normalize(text);
  return { source, emergency: isEmergency(raw, cleaned), covered: false,
    threshold: config.threshold, passage_threshold: 2, quote_eligible: false, passage_method: 'none',
    cleaned, removed_personal_data: removed, timing_ms: { embed: 0, total: 0 },
    compared: 0, results: [], passages: [], passages_compared: 0, passage_parents_compared: 0,
    ...(indicScript(raw) ? { reason: 'script_unsupported' } : {}) };
}

// ---- keyword fallback -------------------------------------------------------
const STOP = new Set('a an the i my me we our is are was be to of in on for and or how do does did can what which where who whom why when it this that with from at by not get need want should will have has been please there any about into after since still'.split(' '));
const tokens = s => normalize(s).split(' ').filter(w => w.length > 1 && !STOP.has(w));
const fields = cards.map(c => ({
  id: c.id,
  strong: new Set([...c.keywords.flatMap(tokens), ...tokens(c.title)]),
  weak: new Set([...tokens(c.summary), ...c.examples.flatMap(tokens)]),
  phrases: c.keywords.map(normalize).filter(k => k.includes(' ')),
}));
const df = {};
for (const f of fields) for (const w of new Set([...f.strong, ...f.weak])) df[w] = (df[w] || 0) + 1;
const idf = w => Math.log(1 + cards.length / (df[w] || 0.5));
const has = (set, w) => set.has(w) || (w.length >= 5 && [...set].some(x => x.length >= 5 && (x.startsWith(w) || w.startsWith(x))));
export const KEYWORD_MIN = 4; // roughly: one distinctive keyword plus one supporting word
export const KEYWORD_AMBIGUOUS = 0.85; // second card within 15% of the first: let the person choose

export function keywordSearch(raw) {
  const started = performance.now();
  const metadata = searchMetadata(raw, 'keyword');
  const norm = metadata.cleaned;
  if (metadata.reason || !norm) return { ...metadata, ambiguous: false, threshold: KEYWORD_MIN, ms: 0 };
  const words = [...new Set(norm.split(' ').filter(w => w.length > 1 && !STOP.has(w)))];
  const scored = fields.map(f => {
    let s = 0;
    for (const w of words) s += has(f.strong, w) ? 2 * idf(w) : has(f.weak, w) ? idf(w) : 0;
    for (const p of f.phrases) if (norm.includes(p)) s += 3;
    return { id: f.id, score: Math.round(s * 100) / 100, via: 'keyword', matched: cardById[f.id].title };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
  const strong = scored[0].score >= KEYWORD_MIN;
  const ambiguous = strong && scored[1].score >= KEYWORD_AMBIGUOUS * scored[0].score;
  const passageResults = keywordPassages(norm, scored[0].id);
  const total = Math.round(performance.now() - started);
  return { ...metadata, covered: strong && !ambiguous, ambiguous, threshold: KEYWORD_MIN,
    results: scored, compared: cards.length, ...passageResults,
    timing_ms: { embed: 0, total }, ms: total };
}

// ---- entry point ------------------------------------------------------------
export async function searchQuestion(raw, { endpoint = `${API_BASE}/api/search`, timeoutMs = API_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const metadata = searchMetadata(raw, 'embedding');
  if (metadata.reason || !metadata.cleaned) return { ...metadata, source: 'local', ms: 0 };
  const started = performance.now();
  const controller = new AbortController();
  let timer;
  // The deadline settles on its own; abort is only cleanup, so a fetch that ignores the signal can't hang us.
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { name: 'AbortError' })); }, timeoutMs); });
  try {
    const call = (async () => {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: raw }), signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return response.json();
    })();
    call.catch(() => {});
    const body = await Promise.race([call, deadline]);
    const results = (body.results || []).filter(r => Object.hasOwn(cardById, r.id));
    if (!results.length) { if (body.reason === 'script_unsupported') return { ...metadata, reason: body.reason, ms: Math.round(performance.now() - started) }; throw new Error('empty result'); }
    // The browser's own emergency check always applies, even if the server disagrees.
    const total = Math.round(performance.now() - started);
    return { ...metadata, ...body, cleaned: metadata.cleaned, removed_personal_data: metadata.removed_personal_data,
      results, emergency: body.emergency || metadata.emergency, source: 'embedding',
      timing_ms: { embed: body.timing_ms?.embed ?? 0, total }, ms: total };
  } catch (error) {
    const result = keywordSearch(raw);
    const total = Math.round(performance.now() - started);
    return { ...result, source: 'keyword', fallbackReason: error.name === 'AbortError' ? 'timeout' : 'unavailable',
      timing_ms: { embed: 0, total }, ms: total };
  } finally {
    clearTimeout(timer);
  }
}
