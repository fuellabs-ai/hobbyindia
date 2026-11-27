// Every flow: cards exist, start exists, every next points to a real node, every node is
// reachable, every link is https and allowed by safeUrl, every ending has a link or a call.
//   node tests/check_flows.mjs
import { build } from 'esbuild';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const here = p => new URL(p, import.meta.url).pathname;
const out = join(mkdtempSync(join(tmpdir(), 'flows-')), 's.mjs');
await build({ entryPoints: [here('../src/search.js')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { safeUrl, cardById } = await import(pathToFileURL(out));
const { flows } = JSON.parse(readFileSync(here('../data/flows.json')));
const errors = [];
const seenCards = new Set();
for (const f of flows) {
  const err = m => errors.push(`${f.id}: ${m}`);
  for (const c of f.cards) { if (!cardById[c]) err(`unknown card ${c}`); if (seenCards.has(c)) err(`card ${c} in two flows`); seenCards.add(c); }
  if (!f.nodes[f.start]) err('missing start');
  const reach = new Set(); const stack = [f.start];
  while (stack.length) { const id = stack.pop(); if (reach.has(id) || !f.nodes[id]) continue; reach.add(id); const n = f.nodes[id]; for (const x of [...(n.options || []), ...(n.fails || [])]) { if (!f.nodes[x.next]) err(`${id} -> missing ${x.next}`); stack.push(x.next); } }
  for (const [id, n] of Object.entries(f.nodes)) {
    if (!reach.has(id)) err(`${id} unreachable`);
    if (!n.ask && !n.step) err(`${id} has neither ask nor step`);
    if (n.step) {
      if (!n.link && !n.call) err(`${id} ending without link or call`);
      if (n.link && !safeUrl(n.link.url)) err(`${id} link not allowed: ${n.link.url}`);
      if (!Array.isArray(n.fails)) err(`${id} missing fails`);
      if (/UNVERIFIED/i.test(JSON.stringify(n))) err(`${id} contains UNVERIFIED`);
    }
  }
}
console.log(`${flows.length} flows, ${flows.reduce((a, f) => a + Object.keys(f.nodes).length, 0)} nodes: ${errors.length ? errors.length + ' problems' : 'all valid'}`);
errors.forEach(e => console.log('  ' + e));
process.exit(errors.length ? 1 : 0);
