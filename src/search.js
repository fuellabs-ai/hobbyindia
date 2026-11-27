// Question search. Server: /api/search (HobbyLM-Embed). If it fails or takes longer than
// 2 s, a keyword search over the same static cards runs in the browser, so a question
// always gets an answer from the card set and nothing is ever generated.
// normalize / redact / isEmergency must stay identical to server/search_core.py.
import servicesData from '../data/services.json';
import hinglishData from '../data/hinglish_map.json';
import tanglishData from '../data/tanglish_map.json';
import kanglishData from '../data/kanglish_map.json';
import emergencyData from '../data/emergency.json';
import flowData from '../data/flows.json';

export const cards = servicesData.cards;
export const cardById = Object.fromEntries(cards.map(c => [c.id, c]));
export const emergencyContacts = emergencyData.contacts;
export const API_TIMEOUT_MS = 2000;
// Where the search server lives. Empty = same origin (local dev / single-box). On Vercel: the HF Space URL.
export const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');
const MAX_QUERY_CHARS = 300;

// Outgoing links: https only, and only to hosts that appear in our data files.
const flowLinks = flowData.flows.flatMap(f => Object.values(f.nodes).map(n => n.link?.url).filter(Boolean));
const ALLOWED_HOSTS = new Set([...cards.map(c => c.official_url), ...emergencyData.contacts.map(c => c.official_url), ...flowLinks].map(u => new URL(u).hostname));
export function safeUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? u.href : undefined; } catch { return undefined; }
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Same order as PHRASE_MAPS in server/search_core.py: the first map wins on a clash.
const phraseMap = {};
for (const m of [hinglishData, tanglishData, kanglishData]) for (const [k, v] of Object.entries(m.phrases)) if (!(k in phraseMap)) phraseMap[k] = v;
const phrases = Object.keys(phraseMap).sort((a, b) => b.length - a.length);
const hinglishRe = new RegExp(`(?<![a-z0-9])(${phrases.map(escape).join('|')})(?![a-z0-9])`, 'g');
const emergencyRes = emergencyData.patterns.map(p => new RegExp(p));
// Explicit ASCII classes so Python and JS agree (tests/parity.mjs).
const PII = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.]+/g,
  /(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/g,
  /(?:\+?[0-9][\s().-]*){6,}/g,
];

export function redact(text) {
  let found = false;
  for (const rx of PII) text = text.replace(rx, () => { found = true; return ' '; });
  return [text, found];
}

export function normalize(text) {
  // Array.from counts code points, like Python slicing (not UTF-16 units).
  let t = Array.from(text.toLowerCase()).slice(0, MAX_QUERY_CHARS).join('').replace(/[\u2019'`]/g, '');
  t = t.replace(/[^a-z0-9\u0900-\u097f]+/g, ' ');
  t = t.replace(hinglishRe, (_, p) => ` ${phraseMap[p]} `);
  return t.replace(/\s+/g, ' ').trim();
}

export function isEmergency(raw, normalized = normalize(redact(raw)[0])) {
  const low = raw.toLowerCase().replace(/\s+/g, ' ');
  return emergencyRes.some(rx => rx.test(low) || rx.test(normalized));
}

// Mirrors indic_script in server/search_core.py.
export function indicScript(text) {
  const letters = [...text].filter(ch => /\p{L}/u.test(ch));
  return letters.length > 0 && letters.filter(ch => ch >= '\u0900' && ch <= '\u0dff').length / letters.length > 0.3;
}
const scriptResult = raw => ({ emergency: isEmergency(raw), covered: false, reason: 'script_unsupported', results: [] });

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
  const [text] = redact(raw);
  const norm = normalize(text);
  const words = [...new Set(tokens(text))];
  const scored = fields.map(f => {
    let s = 0;
    for (const w of words) s += has(f.strong, w) ? 2 * idf(w) : has(f.weak, w) ? idf(w) : 0;
    for (const p of f.phrases) if (norm.includes(p)) s += 3;
    return { id: f.id, score: Math.round(s * 100) / 100 };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
  const strong = scored[0].score >= KEYWORD_MIN;
  const ambiguous = strong && scored[1].score >= KEYWORD_AMBIGUOUS * scored[0].score;
  return { emergency: isEmergency(raw, norm), covered: strong && !ambiguous, ambiguous, threshold: KEYWORD_MIN, results: scored };
}

// ---- entry point ------------------------------------------------------------
export async function searchQuestion(raw, { endpoint = `${API_BASE}/api/search`, timeoutMs = API_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (indicScript(raw)) return { ...scriptResult(raw), source: 'local', ms: 0 };
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
    const results = (body.results || []).filter(r => cardById[r.id]);
    if (!results.length) { if (body.reason === 'script_unsupported') return { ...scriptResult(raw), source: 'embedding' }; throw new Error('empty result'); }
    // The browser's own emergency check always applies, even if the server disagrees.
    return { ...body, results, emergency: body.emergency || isEmergency(raw), source: 'embedding', ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ...keywordSearch(raw), source: 'keyword', fallbackReason: error.name === 'AbortError' ? 'timeout' : 'unavailable', ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}
