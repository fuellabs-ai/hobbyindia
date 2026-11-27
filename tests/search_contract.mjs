// Exercise the real retrieval code with deterministic, shared query embeddings.
// ONNX/tokenization alone are mocked, so loading vectors, row attribution,
// department filtering, guards, cache privacy and response shape are all checked.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pythonPath = join(dirname(root.slice(0, -1)), '.venv/bin/python');
const cases = ['passport delayed', 'legal aid advice', 'RTI appeal', 'पुलिस सहायता', '1234567890', 'passport police 1234567890'];
const python = `import sys,json,threading,tempfile,pathlib,http.client,contextlib,io
sys.path.insert(0, ${JSON.stringify(join(root, 'server'))})
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import numpy as np
import search_server as s
import build_passages as build
meta=s.core.load_json('index/index.json')
vectors=np.fromfile(s.core.INDEX_DIR/'vectors.f32',dtype='<f4').reshape(len(meta['rows']),meta['dim'])
cards=[c['id'] for c in s.core.load_cards()]
def seed(text):
    card='passport' if 'passport' in text else 'free-legal-aid' if 'legal aid' in text else 'rti-file'
    v=vectors[cards.index(card)].copy()
    return v/np.linalg.norm(v)
class Model:
    def encode_query(self,texts,**kwargs): return np.array([seed(t) for t in texts])
index=s.Index(Model())
results=[index.search(q)[0] for q in json.load(sys.stdin)]
with tempfile.TemporaryDirectory() as td:
    p=pathlib.Path(td)/'capture.txt'
    p.write_text('Q: What documents should I bring?\\nA:\\nList of documents?\\n- Original card\\n- Copy of the first page\\nCategory | Required document\\nMinor | Parent passport\\n\\nQ: Where do I ask for help?\\nA:\\nPlease contact the Passport Office concerned.\\n')
    parsed=build.passport_pairs(p)
    assert len(parsed)==2 and 'Minor | Parent passport' in parsed[0][1]
    p.write_text('What documents should I bring?\\nMinor\\n')
    try: build.passport_pairs(p)
    except ValueError: pass
    else: raise AssertionError('collapsed capture accepted')
    s.FEEDBACK_FILE=str(pathlib.Path(td)/'feedback.json')
    handler=s.make_handler(index)
    cache=next(c.cell_contents for c in handler.do_POST.__closure__ if isinstance(c.cell_contents,s.Cache))
    server=s.ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    def ask(q):
        conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
        conn.request('POST','/api/search',json.dumps({'q':q}))
        res=conn.getresponse(); data=json.loads(res.read()); hit=res.getheader('X-Cache');conn.close()
        assert res.status==200
        return data,hit
    logs=io.StringIO()
    try:
        with contextlib.redirect_stderr(logs):
            prime,_=ask('passport delayed')
            hit,kind=ask('passport delayed person@example.com')
            assert kind=='hit' and hit['removed_personal_data'] and hit['cleaned']=='passport delayed'
            assert hit['timing_ms']['embed']==0
            emergency,kind=ask('passport delayed'+' '*310+'police')
            assert kind=='hit' and emergency['emergency']
        assert 'person@example.com' not in logs.getvalue() and 'passport delayed' not in logs.getvalue()
        assert all(isinstance(k[1],bytes) and len(k[1])==32 for k in cache.data)
        assert all(not ({'cleaned','removed_personal_data','emergency','timing_ms','ms'} & body.keys()) for body in cache.data.values())
        assert len(cache.data)==1
    finally:server.shutdown();server.server_close()
print(json.dumps({'results':results,'seeds':{c:seed(t).tolist() for c,t in [('passport','passport'),('free-legal-aid','legal aid'),('rti-file','RTI')]}}))`;
const server = JSON.parse(execFileSync(pythonPath, ['-c', python], { cwd: root, input: JSON.stringify(cases), maxBuffer: 8e6 }).toString());
const out = join(mkdtempSync(join(tmpdir(), 'hobby-contract-')), 'private.mjs');
await build({ stdin: { contents: `export * from './src/privateSearch.js'; export { keywordSearch, searchQuestion } from './src/search.js';`, resolveDir: root },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', loader: { '.f32': 'file' },
  define: { 'import.meta.env.VITE_PRIVATE_MODEL_URL': '""' }, plugins: [{ name: 'deterministic-model', setup(b) {
    b.onResolve({ filter: /^(onnxruntime-web\/wasm|@huggingface\/transformers)$/ }, args => ({ path: args.path, namespace: 'model' }));
    b.onLoad({ filter: /.*/, namespace: 'model' }, args => ({ contents: args.path.startsWith('onnx')
      ? `export const env={wasm:{}}; export class Tensor {constructor(type,data,dims){Object.assign(this,{type,data,dims})}};
         export const InferenceSession={create:async()=>({run:async()=>({embedding:{data:globalThis.contractVector()}})})};`
      : `export const env={}; export const AutoTokenizer={from_pretrained:async()=>texts=>{globalThis.contractText=texts[0]; const t={data:BigInt64Array.of(1n),dims:[1,1]};return {input_ids:t,attention_mask:t}}};` }));
  } }] });

globalThis.self = { crossOriginIsolated: false };
globalThis.contractVector = () => {
  const text = globalThis.contractText;
  assert(!/[0-9]{6,}/.test(text), 'PII reached private tokenizer');
  return Float32Array.from(server.seeds[text.includes('passport') ? 'passport' : text.includes('legal aid') ? 'free-legal-aid' : 'rti-file']);
};
const stored = new Map(), downloads = [];
globalThis.caches = { open: async () => ({ match: async key => stored.get(key)?.clone(), put: async (key, value) => stored.set(key, value) }) };
globalThis.fetch = async url => {
  downloads.push(String(url));
  if (String(url).includes('passages-')) return new Response(readFileSync(join(root, 'data/index/passages.f32')));
  if (String(url).includes('vectors-')) return new Response(readFileSync(join(root, 'data/index/vectors.f32')));
  return new Response(new Uint8Array([0]));
};
const search = await import(pathToFileURL(out));
await search.loadPrivateModel();
assert(downloads.some(url => url.includes('passages-')), 'private mode did not load passage vectors');
const passageData = JSON.parse(readFileSync(join(root, 'data/sources/passages.json'), 'utf8'));
const { passages, chunks } = passageData;
const byId = new Map(passages.map(p => [p.id, p]));
const required = ['cleaned', 'removed_personal_data', 'timing_ms', 'compared', 'results', 'passages', 'passages_compared', 'passage_parents_compared', 'passage_threshold', 'quote_eligible', 'passage_method'];
function check(body) {
  for (const key of required) assert(Object.hasOwn(body, key), `missing ${key}`);
  assert(body.timing_ms.total >= body.timing_ms.embed);
  for (const result of body.results) { assert(['card', 'example', 'keyword'].includes(result.via)); assert.equal(typeof result.matched, 'string'); }
  const eligible = passages.filter(p => p.cards.includes(body.results[0]?.id));
  const eligibleIds = new Set(eligible.map(p => p.id));
  assert.equal(body.passage_parents_compared, eligible.length);
  assert.equal(body.passages_compared, chunks.filter(c => eligibleIds.has(c.parent_id)).length);
  for (const p of body.passages) assert(eligible.some(e => e.id === p.id) && byId.has(p.id));
  assert(body.passages.length <= 3);
  assert.equal(new Set(body.passages.map(p => p.id)).size, body.passages.length);
  if (body.quote_eligible) {
    assert.equal(body.passage_method, 'hybrid');
    assert(body.passages[0].quote_eligible);
    assert(body.passages[0].score >= body.passage_threshold);
    assert.equal(body.passages.filter(p => p.quote_eligible).length, 1);
  } else {
    assert(body.passages.every(p => p.score < body.passage_threshold), 'score-only UI gate opened on disagreement');
  }
}
for (const [i, raw] of cases.entries()) {
  const local = await search.privateSearch(raw), api = server.results[i], keyword = search.keywordSearch(raw);
  for (const body of [local, api, keyword]) check(body);
  assert.equal(local.cleaned, api.cleaned); assert.equal(local.removed_personal_data, api.removed_personal_data);
  assert.equal(local.emergency, api.emergency);
  assert.deepEqual(local.results.map(r => [r.id, r.via, r.matched]), api.results.map(r => [r.id, r.via, r.matched]));
  assert.deepEqual(local.passages.map(p => p.id), api.passages.map(p => p.id));
  assert.equal(local.quote_eligible, api.quote_eligible);
  assert.equal(local.passage_method, api.passage_method);
  for (let j = 0; j < local.passages.length; j++) assert(Math.abs(local.passages[j].score - api.passages[j].score) < 0.0002);
}
const fallback = await search.searchQuestion('passport delayed', { timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
check(fallback); assert.equal(fallback.source, 'keyword'); assert.equal(fallback.fallbackReason, 'timeout');
assert(fallback.timing_ms.total >= 4);
console.log('search contract: server/private/keyword, passage loading/ranking, guards, timeout, cache privacy and Passport parser passed');
