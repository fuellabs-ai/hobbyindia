// Runs tests/questions.json through (1) the real /api/search server and (2) the browser
// keyword fallback, and writes every result, including failures, to tests/results.json.
//   node tests/run_eval.mjs [http://127.0.0.1:8791/api/search]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = process.argv[2] || 'http://127.0.0.1:8791/api/search';
const out = join(mkdtempSync(join(tmpdir(), 'search-eval-')), 'search.mjs');
await build({ entryPoints: [new URL('../src/search.js', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const search = await import(pathToFileURL(out));
const qfile = process.argv[3] || 'questions.json';
const { questions } = JSON.parse(readFileSync(new URL(qfile, import.meta.url)));

function grade(expected, r) {
  if (expected[0] === 'emergency') return r.emergency ? 'pass' : 'FAIL';
  if (expected[0] === 'not_covered') return r.covered ? 'FAIL' : 'pass';
  if (r.emergency) return 'FAIL (false emergency)';
  if (!r.covered) return expected.includes(r.results[0].id) ? 'partial (right card, below threshold)' : expected.some(e => r.results.some(x => x.id === e)) ? 'partial (in closest 3, below threshold)' : 'FAIL (not covered)';
  return expected.includes(r.results[0].id) ? 'pass' : 'FAIL (wrong card)';
}

const rows = [];
for (const t of questions) {
  const api = await search.searchQuestion(t.q, { endpoint, timeoutMs: 2000 });
  const kw = search.keywordSearch(t.q);
  rows.push({ ...t, normalized: search.normalize(t.q), api: { source: api.source, ms: api.ms, emergency: api.emergency, covered: api.covered, results: api.results, grade: grade(t.expected, api) }, keyword: { emergency: kw.emergency, covered: kw.covered, results: kw.results, grade: grade(t.expected, kw) } });
}
// Allow validation without touching UI-owned/frozen question or result files.
const resultName = qfile.replace('.json', '') + '.results.json';
if (process.env.EVAL_OUTPUT_DIR) mkdirSync(process.env.EVAL_OUTPUT_DIR, { recursive: true });
writeFileSync(process.env.EVAL_OUTPUT_DIR ? join(process.env.EVAL_OUTPUT_DIR, resultName) : new URL(resultName, import.meta.url), JSON.stringify(rows, null, 1) + '\n');

const fmt = r => r.results.map(x => `${x.id} ${x.score}`).join(', ');
for (const r of rows) {
  console.log(`\n[${r.id}] ${r.q}\n  normalized: ${r.normalized}\n  expected:   ${r.expected.join(' | ')}`);
  console.log(`  embed  (${r.api.source}, ${r.api.ms} ms) ${r.api.emergency ? 'EMERGENCY ' : ''}${r.api.covered ? 'covered' : 'NOT COVERED'}: ${fmt(r.api)}  => ${r.api.grade}`);
  console.log(`  keyword ${r.keyword.emergency ? 'EMERGENCY ' : ''}${r.keyword.covered ? 'covered' : 'NOT COVERED'}: ${fmt(r.keyword)}  => ${r.keyword.grade}`);
}
const tally = (k, lang) => { const g = rows.filter(r => !lang || r.lang === lang).map(r => r[k].grade); return `${g.filter(x => x === 'pass').length} pass, ${g.filter(x => x.startsWith('partial')).length} partial, ${g.filter(x => x.startsWith('FAIL')).length} fail`; };
console.log(`\nembedding: ${tally('api')}  (en ${tally('api', 'en')}; hinglish ${tally('api', 'hinglish')})`);
console.log(`keyword:   ${tally('keyword')}  (en ${tally('keyword', 'en')}; hinglish ${tally('keyword', 'hinglish')})`);
// Gate metric: expected card anywhere in the top 3 (cards), emergency flag (emergency), not covered (not_covered).
const gate = r => r.expected[0] === 'emergency' ? r.api.emergency : r.expected[0] === 'not_covered' ? !r.api.covered : r.api.results.some(x => r.expected.includes(x.id));
const g = rows.filter(gate).length;
console.log(`gate (top-3 / emergency / not-covered): ${g}/${rows.length} = ${Math.round(100 * g / rows.length)}%  | emergency ${rows.filter(r => r.expected[0] === 'emergency' && r.api.emergency).length}/${rows.filter(r => r.expected[0] === 'emergency').length}`);
for (const l of [...new Set(rows.map(r => r.lang))]) { const s = rows.filter(r => r.lang === l); console.log(`  ${l}: ${s.filter(gate).length}/${s.length}`); }
