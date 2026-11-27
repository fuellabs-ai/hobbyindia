import {defineConfig} from 'vite';
// /api and /models -> server/search_server.py. COOP/COEP let private mode use several CPU threads.
const isolation = {'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'};
export default defineConfig({
  server: {headers: isolation, proxy: {'/api': {target: 'http://127.0.0.1:8791'}, '/models': {target: 'http://127.0.0.1:8791'}}},
  preview: {headers: isolation},
  optimizeDeps: {exclude: ['onnxruntime-web']},
});
