// Build the HobbyLM-Embed-Mini index with the SAME int8 ONNX + tokenizer the browser uses
// (never mixed with the 140M teacher's vectors).
//   node scripts/build_mini_index.mjs [/path/to/hobbylm-embed-mini]
// Writes data/index-mini/{vectors.f32, passages.f32, index.json}.
import { build } from 'esbuild';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer, env } from '@huggingface/transformers';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = p => new URL(p, import.meta.url).pathname;
export const MINI_DIR = process.argv[2] || process.env.MINI_DIR || '../models/hobbylm-embed-mini';
const ONNX = `${MINI_DIR}/out/hobbylm-embed-mini.int8.onnx`;
const MAX_LEN = 256; // hard limit of the Mini (tokenizer_config's 512 is wrong)

export async function loadMini() {
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${MINI_DIR}/out/`;
  const tokenizer = await AutoTokenizer.from_pretrained('student_pytorch');
  const session = await ort.InferenceSession.create(ONNX);
  const check = tokenizer(['query: hello world']).input_ids.tolist()[0].map(Number);
  if (JSON.stringify(check) !== JSON.stringify([22766, 25, 23748, 995, 50256])) throw new Error(`tokenizer mismatch: ${check}`);
  async function embed(texts, batch = 16) {
    const out = [];
    for (let i = 0; i < texts.length; i += batch) {
      const enc = tokenizer(texts.slice(i, i + batch), { padding: true, truncation: true, max_length: MAX_LEN });
      const r = await session.run({
        input_ids: new ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims),
        attention_mask: new ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims),
      });
      const e = r.embedding; const d = e.dims[1];
      for (let k = 0; k < e.dims[0]; k++) out.push(Float32Array.from(e.data.subarray(k * d, (k + 1) * d)));
    }
    return out;
  }
  return { embed, sha: createHash('sha256').update(readFileSync(ONNX)).digest('hex') };
}

export async function loadSearch() {
  const out = join(mkdtempSync(join(tmpdir(), 'mini-')), 's.mjs');
  await build({ entryPoints: [here('../src/search.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
  return import(pathToFileURL(out));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await loadSearch();
  const { embed, sha } = await loadMini();
  const services = JSON.parse(readFileSync(here('../data/services.json'))).cards;
  const pd = JSON.parse(readFileSync(here('../data/sources/passages.json')));
  const parents = Object.fromEntries(pd.passages.map(p => [p.id, p]));
  const rows = [], texts = [];
  for (const c of services) { rows.push({ card: c.id, kind: 'card' }); texts.push(`passage: ${c.title}. ${c.summary} Official service: ${c.official_name}.`); }
  for (const c of services) for (const q of c.examples) { rows.push({ card: c.id, kind: 'example' }); texts.push(`query: ${s.normalize(q)}`); }
  const vecs = await embed(texts);
  const pvecs = await embed(pd.chunks.map(ch => `passage: ${parents[ch.parent_id].question}\n${ch.text}`));
  const dir = here('../data/index-mini/'); mkdirSync(dir, { recursive: true });
  const flat = a => { const f = new Float32Array(a.length * a[0].length); a.forEach((v, i) => f.set(v, i * v.length)); return Buffer.from(f.buffer); };
  writeFileSync(dir + 'vectors.f32', flat(vecs)); writeFileSync(dir + 'passages.f32', flat(pvecs));
  writeFileSync(dir + 'index.json', JSON.stringify({ model: 'hobbylm-embed-mini int8 (attempt A)', onnx_sha256: sha, dim: vecs[0].length, max_len: MAX_LEN, rows, passage_chunks: pd.chunks.length, built_at: new Date().toISOString() }, null, 1));
  console.log(`cards ${services.length}, examples ${rows.length - services.length}, chunks ${pvecs.length}, dim ${vecs[0].length}, onnx ${sha.slice(0, 12)}`);
}
