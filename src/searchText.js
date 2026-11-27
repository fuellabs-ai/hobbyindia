// Shared query preprocessing. No query text is retained. Mirrors server/search_core.py.
import hinglishData from '../data/hinglish_map.json';
import tanglishData from '../data/tanglish_map.json';
import kanglishData from '../data/kanglish_map.json';
import emergencyData from '../data/emergency.json';

const MAX_QUERY_CHARS = 300;
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
