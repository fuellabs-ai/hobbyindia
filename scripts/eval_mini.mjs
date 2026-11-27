// HobbyLM-Embed-Mini (int8, browser runtime) evaluation.
// 1) Threshold on PRACTICE data only (same rule as the 140M model: the highest threshold that keeps
//    >= 92% of leave-one-out example questions; off-topic dev questions reported).
// 2) Routing on all fresh test sets: top-3 / emergency / not-covered gate, by language.
//   node scripts/eval_mini.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { loadMini, loadSearch } from './build_mini_index.mjs';

const here = p => new URL(p, import.meta.url).pathname;
const s = await loadSearch();
const { embed } = await loadMini();
const meta = JSON.parse(readFileSync(here('../data/index-mini/index.json')));
const buf = readFileSync(here('../data/index-mini/vectors.f32'));
const V = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), D = meta.dim, R = meta.rows;
const cards = JSON.parse(readFileSync(here('../data/services.json'))).cards.map(c => c.id);
const col = Object.fromEntries(cards.map((c, i) => [c, i]));
const dot = (r, q) => { let t = 0; for (let i = 0; i < D; i++) t += V[r * D + i] * q[i]; return t; };
const score = (q, skip = -1) => { const b = new Array(cards.length).fill(-1); R.forEach((row, r) => { if (r === skip) return; const v = dot(r, q); const c = col[row.card]; if (v > b[c]) b[c] = v; }); return b; };
const top3 = b => b.map((v, i) => ({ id: cards[i], score: v })).sort((a, z) => z.score - a.score).slice(0, 3);
const prep = raw => `query: ${s.normalize(s.redact(raw)[0])}`;

// ---- 1. threshold (practice only)
const services = JSON.parse(readFileSync(here('../data/services.json'))).cards;
const exRows = R.map((r, i) => [r, i]).filter(([r]) => r.kind === 'example');
const exTexts = services.flatMap(c => c.examples);
const exVecs = await embed(exTexts.map(prep));
const loo = exRows.map(([r, i], k) => { const b = score(exVecs[k], i); const t = top3(b)[0]; return { ok: t.id === r.card, s: t.score }; });
const off = JSON.parse(readFileSync(here('../tests/dev_threshold.json'))).not_covered;
const offS = (await embed(off.map(prep))).map(v => top3(score(v))[0].score);
const ins = loo.map(x => x.s).sort((a, b) => a - b);
const THRESH = Math.floor(ins[Math.floor(ins.length * 0.08)] * 100) / 100; // keeps >= 92%
console.log(`practice: LOO top-1 ${loo.filter(x => x.ok).length}/${loo.length}; threshold ${THRESH} keeps ${ins.filter(x => x >= THRESH).length}/${ins.length} in-scope, rejects ${offS.filter(x => x < THRESH).length}/${offS.length} off-topic`);

// ---- 2. tests
const DEPT = { rti: ['rti-file', 'rti-first-appeal'], passport: ['passport'], 'legal-aid': ['free-legal-aid'] };
const sets = [['questions.json', 'original 20'], ['fresh_grok.json', 'g- batch 1 (40)'], ['fresh_grok2.json', 'g- batch 2 (20)'], ['passages_final_questions.json', 't- routing only (45)']];
const all = [];
for (const [f, name] of sets) {
  const qs = JSON.parse(readFileSync(here(`../tests/${f}`))).questions.map(q => ({ ...q, expected: q.expected || DEPT[q.dept] }));
  const vs = await embed(qs.map(q => prep(q.q)));
  const rows = qs.map((q, k) => {
    const em = s.isEmergency(q.q), script = s.indicScript(q.q);
    const t = top3(score(vs[k])); const covered = !script && t[0].score >= THRESH;
    const e = q.expected[0];
    const gate = e === 'emergency' ? em : e === 'not_covered' ? !covered : t.some(x => q.expected.includes(x.id));
    const top1 = e === 'emergency' ? em : e === 'not_covered' ? !covered : covered && q.expected.includes(t[0].id);
    return { set: name, id: q.id, lang: q.lang || 'en', q: q.q, expected: q.expected, top: t.map(x => `${x.id} ${x.score.toFixed(3)}`), gate, top1 };
  });
  all.push(...rows);
  const by = l => { const r = rows.filter(x => x.lang === l); return r.length ? `${l} ${r.filter(x => x.gate).length}/${r.length}` : null; };
  console.log(`${name.padEnd(24)} top-3 gate ${rows.filter(x => x.gate).length}/${rows.length} · right first ${rows.filter(x => x.top1).length}/${rows.length} · ${['en', 'hinglish', 'tanglish', 'kanglish'].map(by).filter(Boolean).join(' · ')}`);
  rows.filter(x => !x.gate).forEach(x => console.log(`   MISS ${x.id} "${x.q}" expected ${x.expected.join('|')} got ${x.top.join(', ')}`));
}
const L = l => { const r = all.filter(x => x.lang === l); return `${r.filter(x => x.gate).length}/${r.length}`; };
console.log(`\nALL ${all.filter(x => x.gate).length}/${all.length} · English ${L('en')} · Hinglish ${L('hinglish')} · Tanglish ${L('tanglish')} · Kanglish ${L('kanglish')}`);
writeFileSync(here('../tests/mini_results.json'), JSON.stringify({ threshold: THRESH, rows: all }, null, 1));
