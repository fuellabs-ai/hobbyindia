import {defineConfig} from 'vite';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
// /api and /models -> server/search_server.py. COOP/COEP let private mode use several CPU threads.
const isolation = {'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'};

// Plan C (server mode) keeps everything; the default local build drops what the browser never
// touches: the 140M teacher's vectors, the privateSearch chunk, the private-model tokenizer
// and ORT's own hashed wasm copies (src/miniSearch.js serves wasm from /ort/ instead).
const serverMode = process.env.VITE_SEARCH_MODE === 'server';
const miniHashes = new Set(['vectors.f32', 'passages.f32'].map(f =>
  createHash('sha256').update(readFileSync(resolve('data/index-mini', f))).digest('hex')));

function dropPlanC({dropTeacher}) {
  return {
    name: 'plan-c-conditional',
    apply: 'build',
    // public/sw.js reads the model hash from here to version its cache like src/miniSearch.js.
    buildStart() { this.emitFile({ type: 'asset', fileName: 'mini-model/index.json', source: readFileSync(resolve('data/index-mini/index.json')) }); },
    generateBundle(_, bundle) {
      for (const key of Object.keys(bundle)) {
        const entry = bundle[key];
        if (entry.type === 'asset' && /\.f32$/.test(entry.fileName)) {
          // keep only the Mini's vector files (content-hash match); drop the teacher's
          const hash = createHash('sha256').update(entry.source).digest('hex');
          if (dropTeacher && !miniHashes.has(hash)) delete bundle[key];
          continue;
        }
        if (entry.type === 'asset' && /ort-wasm[^/]*\.wasm$/.test(entry.fileName)) { delete bundle[key]; continue; }
        if (dropTeacher && entry.type === 'chunk' && entry.name === 'privateSearch') delete bundle[key];
      }
    },
    closeBundle() {
      if (dropTeacher) {
        const dir = resolve('dist/private-model');
        if (existsSync(dir)) rmSync(dir, {recursive: true, force: true});
      }
    },
  };
}

export default defineConfig({
  server: {headers: isolation, proxy: {'/api': {target: 'http://127.0.0.1:8791'}, '/models': {target: 'http://127.0.0.1:8791'}}},
  preview: {headers: isolation},
  optimizeDeps: {exclude: ['onnxruntime-web']},
  plugins: [dropPlanC({dropTeacher: !serverMode})],
});
