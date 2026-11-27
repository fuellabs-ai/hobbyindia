// Independent oracle: execute the ORIGINAL tuning script's chunker and BM25
// functions without executing its model loading, practice loop or file writes.
// Check full Python/JS scores, max-pooling, z-score fusion and gate closure.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = `import ast,json,math,sys
from collections import Counter
import numpy as np
sys.path.insert(0, ${JSON.stringify(join(root, 'server'))})
import search_core as core
from passage_search import PassageSearch
meta=core.load_json('sources/passages.json'); config=core.load_json('search_config.json')
P=meta['passages']
source=ast.parse(open(${JSON.stringify(join(root, 'scripts/tune_passages.py'))}).read())
functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ('chunks','bm25')]
ns={'P':P,'np':np,'math':math,'Counter':Counter}
exec(compile(ast.Module(body=functions,type_ignores=[]),'practice-oracle','exec'),ns)
expected=ns['chunks'](120)
parents={p['id']:i for i,p in enumerate(P)}
actual=[(parents[c['parent_id']],f"{P[parents[c['parent_id']]]['question']}\\n{c['text']}") for c in meta['chunks']]
assert expected==actual, 'child texts differ from practice tuning'
assert all(len(c['text'].split())<=120 for c in meta['chunks'])
vectors=np.fromfile(core.INDEX_DIR/'passages.f32',dtype='<f4').reshape(len(actual),meta['dim'])
assert np.isfinite(vectors).all() and np.allclose(np.linalg.norm(vectors,axis=1),1,atol=1e-5)
engine=PassageSearch(meta,vectors,config)
tok=lambda text:[w for w in core.normalize(text).split() if len(w)>1]
cases=[]
for dept,text in [('rti','Does an online appeal cost another fee?'),('passport','Is a police check needed for my child?'),('legal-aid','Can an employed woman get free legal help?'),('rti','zzzznonexistentword')]:
    rows=[i for i,(pi,_) in enumerate(actual) if P[pi]['dept']==dept]
    pids=sorted({actual[i][0] for i in rows})
    q=vectors[rows[0]].astype(float);q/=np.linalg.norm(q)
    cleaned=core.normalize(core.redact(text)[0])
    ec=vectors[rows]@q
    bc=ns['bm25'](tok(text),[tok(actual[i][1]) for i in rows])
    ev=np.array([max(ec[j] for j,r in enumerate(rows) if actual[r][0]==pi) for pi in pids])
    bv=np.array([max(bc[j] for j,r in enumerate(rows) if actual[r][0]==pi) for pi in pids])
    z=lambda values:(values-values.mean())/(values.std()+1e-9)
    h=.7*z(ev)+.3*z(bv)
    ranked=engine.rank(cleaned,q,dept)
    reference={P[pi]['id']:[float(ev[i]),float(bv[i]),float(h[i])] for i,pi in enumerate(pids)}
    for method,k in [('embedding',0),('keyword',1),('hybrid',2)]:
        for row in ranked[method]:assert abs(row['score']-reference[row['id']][k])<1e-9
    cases.append({'dept':dept,'cleaned':cleaned,'vector':q.tolist(),'ranked':ranked,'response':engine.response(ranked)})
# Population std for a constant channel must yield finite zeros, not NaN.
constant=engine.rank('',np.zeros(meta['dim']),'rti')
assert not constant['quote_eligible'] and all(math.isfinite(r['score']) for r in constant['hybrid'])
print(json.dumps(cases))`;
const cases = JSON.parse(execFileSync(join(dirname(root.slice(0, -1)), '.venv/bin/python'), ['-c', python], { maxBuffer: 8e6, cwd: root }).toString());
const out = join(mkdtempSync(join(tmpdir(), 'hybrid-oracle-')), 'retrieval.mjs');
await build({ entryPoints: [join(root, 'src/passageSearch.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { rankPassages, passageResponse } = await import(pathToFileURL(out));
const bytes = readFileSync(join(root, 'data/index/passages.f32'));
const vectors = new Float32Array(bytes.length / 4);
for (let i = 0; i < vectors.length; i++) vectors[i] = bytes.readFloatLE(i * 4);
for (const fixture of cases) {
  const ranked = rankPassages(fixture.cleaned, fixture.vector, vectors, fixture.dept);
  assert.equal(ranked.quote_eligible, fixture.ranked.quote_eligible);
  assert.equal(ranked.compared, fixture.ranked.compared);
  assert.equal(ranked.parents_compared, fixture.ranked.parents_compared);
  for (const method of ['embedding', 'keyword', 'hybrid']) {
    assert.deepEqual(ranked[method].map(p => p.id), fixture.ranked[method].map(p => p.id));
    for (const [i, row] of ranked[method].entries()) assert(Math.abs(row.score - fixture.ranked[method][i].score) < 1e-7);
  }
  const response = passageResponse(ranked);
  assert.equal(response.quote_eligible, fixture.response.quote_eligible);
  assert.equal(response.passage_threshold, fixture.response.passage_threshold);
  assert.deepEqual(response.passages.map(p => p.id), fixture.response.passages.map(p => p.id));
  const keywordOnly = passageResponse(rankPassages(fixture.cleaned, null, null, fixture.dept));
  assert.equal(keywordOnly.quote_eligible, false);
  assert(keywordOnly.passages.every(p => p.score < keywordOnly.passage_threshold));
}
const metadata = JSON.parse(readFileSync(join(root, 'data/sources/passages.json')));
const constant = rankPassages('', new Float32Array(metadata.dim), vectors, 'rti');
assert(!constant.quote_eligible && constant.hybrid.every(p => Number.isFinite(p.score)));
assert.equal(passageResponse(constant).passage_threshold, 2);
console.log('hybrid oracle: practice chunker/BM25, parent pooling, Python/JS full rankings, zero-variance channels and quote gates passed');
