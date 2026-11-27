// Python and JS must agree on redact / normalize / emergency / indic-script for every fixture
// plus every test question. Run: node tests/parity.mjs (needs ../.venv python).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const here = p => new URL(p, import.meta.url).pathname;
const out = join(mkdtempSync(join(tmpdir(), 'parity-')), 's.mjs');
await build({ entryPoints: [here('../src/search.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const s = await import(pathToFileURL(out));
const texts = [...JSON.parse(readFileSync(here('parity_fixtures.json'))), ...['questions.json', 'fresh_grok.json'].flatMap(f => JSON.parse(readFileSync(here(f))).questions.map(q => q.q))];
const py = JSON.parse(execFileSync(here('../../.venv/bin/python'), ['-c', `
import json,sys; sys.path.insert(0, ${JSON.stringify(here('../server'))}); import search_core as c
out=[]
for t in json.load(sys.stdin):
    r,pii=c.redact(t); n=c.normalize(r); out.append([r,pii,n,c.is_emergency(t,n),c.indic_script(t)])
print(json.dumps(out))`], { input: JSON.stringify(texts) }).toString());
let bad = 0;
texts.forEach((t, i) => {
  const [r, pii] = s.redact(t); const n = s.normalize(r);
  const js = [r, pii, n, s.isEmergency(t, n), s.indicScript(t)];
  if (JSON.stringify(js) !== JSON.stringify(py[i])) { bad++; console.log('MISMATCH', JSON.stringify(t).slice(0, 60), '\n  py', JSON.stringify(py[i]).slice(0, 160), '\n  js', JSON.stringify(js).slice(0, 160)); }
});
console.log(`parity: ${texts.length - bad}/${texts.length} identical`);
process.exit(bad ? 1 : 0);
