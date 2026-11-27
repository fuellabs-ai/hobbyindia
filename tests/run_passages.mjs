// Department-scoped passage retrieval, independently of card routing and display
// thresholds. MRR uses the complete department ranking, not just the top three.
// node tests/run_passages.mjs <labelled.json>
// Labels: {questions: [{id, dept, q, expected: ['rti-003']}]}; [] = no answer.
// Reports frozen embedding/BM25/hybrid settings and the agreement quote gate.
// This evaluator never changes the configuration or labels.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(a => a.startsWith('--'))) throw new Error('Evaluation only: retrieval settings are frozen from practice');
const filenames = args;
if (!filenames.length) throw new Error('Usage: node tests/run_passages.mjs <labelled.json> [more-labelled.json]');
const questions = filenames.flatMap(filename => {
  const input = JSON.parse(readFileSync(resolve(filename), 'utf8'));
  return Array.isArray(input) ? input : input.questions || [];
});
if (!questions?.length) throw new Error('No labelled questions');
const passageData = JSON.parse(readFileSync(join(root, 'data/sources/passages.json'), 'utf8'));
const byId = new Map(passageData.passages.map(p => [p.id, p]));
for (const question of questions) {
  question.q ??= question.question;
  question.expected ??= question.expected_passage_ids ?? question.expected_passages;
  if (!Array.isArray(question.expected) || typeof question.q !== 'string') throw new Error('Each question needs q and expected passage ids');
  question.dept ??= byId.get(question.expected[0])?.dept;
  if (!passageData.passages.some(p => p.dept === question.dept)) throw new Error(`Unknown department for ${question.id}`);
  if (question.expected.some(id => byId.get(id)?.dept !== question.dept)) throw new Error(`Unknown or cross-department label for ${question.id}`);
}

const out = join(mkdtempSync(join(tmpdir(), 'hobby-passages-')), 'search.mjs');
await build({ stdin: { contents: `export { normalize, redact } from './src/search.js'; export { rankPassages } from './src/passageSearch.js';`, resolveDir: root },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { normalize, redact, rankPassages } = await import(pathToFileURL(out));
const cleaned = questions.map(q => normalize(redact(q.q)[0]));
// Questions travel to the local subprocess over stdin, never command arguments or
// intermediate files. The model's stdout contains vectors only.
const python = `import json,sys
sys.path.insert(0, ${JSON.stringify(join(root, 'server'))})
import search_core as core
from sentence_transformers import SentenceTransformer
model=SentenceTransformer(core.MODEL_ID, revision=core.MODEL_REVISION, trust_remote_code=True, device='cpu')
texts=json.load(sys.stdin)
vectors=model.encode_query(texts, normalize_embeddings=True, convert_to_numpy=True, batch_size=16, show_progress_bar=False)
print(json.dumps(vectors.tolist()))`;
const vectors = JSON.parse(execFileSync(process.env.PYTHON || join(dirname(root.slice(0, -1)), '.venv/bin/python'), ['-c', python],
  { input: JSON.stringify(cleaned), maxBuffer: 64 * 1024 * 1024, cwd: root, stdio: ['pipe', 'pipe', 'inherit'] }).toString());
const bytes = readFileSync(join(root, 'data/index/passages.f32'));
if (bytes.length !== passageData.chunks.length * passageData.dim * 4) throw new Error('Passage vectors/metadata mismatch');
const passageVectors = new Float32Array(bytes.length / 4);
for (let i = 0; i < passageVectors.length; i++) passageVectors[i] = bytes.readFloatLE(i * 4);
const rows = questions.map((question, i) => {
  const ranked = rankPassages(cleaned[i], vectors[i], passageVectors, question.dept);
  const rankings = { embedding: ranked.embedding, keyword: ranked.keyword, hybrid: ranked.hybrid };
  return { ...question, quote_eligible: ranked.quote_eligible, rankings, ranks: Object.fromEntries(Object.entries(rankings).map(([method, ranking]) => {
    const at = ranking.findIndex(p => question.expected.includes(p.id));
    return [method, at < 0 ? 0 : at + 1];
  })) };
});

function report(group, label) {
  // Unanswerable rows contribute to quote precision, not to hit/MRR.
  const positives = group.filter(q => q.expected.length);
  for (const method of ['embedding', 'keyword', 'hybrid']) {
    const n = positives.length;
    const hit = k => n ? positives.filter(q => q.ranks[method] > 0 && q.ranks[method] <= k).length / n : 0;
    const mrr = n ? positives.reduce((s, q) => s + (q.ranks[method] ? 1 / q.ranks[method] : 0), 0) / n : 0;
    console.log(`${label} ${method === 'embedding' ? 'HobbyLM-Embed' : method === 'keyword' ? 'BM25' : 'Hybrid 0.7/0.3'}: n=${n} hit@1=${hit(1).toFixed(3)} hit@3=${hit(3).toFixed(3)} MRR=${mrr.toFixed(3)}`);
  }
}
report(rows, 'overall');
for (const dept of [...new Set(rows.map(q => q.dept))].sort()) report(rows.filter(q => q.dept === dept), dept);
for (const row of rows) for (const method of ['embedding', 'keyword', 'hybrid']) {
  if (row.expected.length && row.ranks[method] !== 1) console.log(`MISS ${method} ${row.id ?? `row-${rows.indexOf(row) + 1}`} [${row.dept}] expected=${row.expected.join('|')} rank=${row.ranks[method]} top3=${row.rankings[method].slice(0, 3).map(p => `${p.id}:${p.score.toFixed(4)}`).join(',')}`);
}
const negatives = rows.filter(q => !q.expected.length).length;
if (negatives) console.log(`${negatives} unanswerable dev rows excluded from hit/MRR; included in quote-gate precision.`);

function reportQuotes(group, label) {
  const shown = group.filter(row => row.quote_eligible);
  const right = shown.filter(row => row.expected.includes(row.rankings.hybrid[0]?.id)).length;
  console.log(`${label} agreement gate: shown=${shown.length}/${group.length} right=${right}/${shown.length} precision=${shown.length ? (right / shown.length).toFixed(3) : 'n/a'}`);
  for (const row of shown) if (!row.expected.includes(row.rankings.hybrid[0]?.id)) console.log(`QUOTE MISS ${row.id ?? '(unnamed)'} [${row.dept}] predicted=${row.rankings.hybrid[0]?.id} expected=${row.expected.join('|') || '(no answer)'}`);
}
reportQuotes(rows, 'overall');
for (const dept of [...new Set(rows.map(q => q.dept))].sort()) reportQuotes(rows.filter(q => q.dept === dept), dept);
