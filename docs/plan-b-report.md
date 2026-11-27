Plan B is built, tested, and green. Nothing deployed, pushed, or uploaded.

## Test results

**Accuracy (gate must hold)** — `node scripts/eval_mini.mjs`, threshold re-selected on practice only = **0.72**:
| Set | Required | Got |
|---|---|---|
| original 20 | 20/20 | **20/20** |
| g- batch 1 (40) | 36/40 | **36/40** |
| g- batch 2 (20) | 18/20 | **18/20** |
| t- routing only (45) | — | 34/45 (matches the HANDOFF §12 baseline exactly) |

**Regression tests:** `tests/parity.mjs` **75/75 identical** · `tests/check_flows.mjs` **10 flows, 48 nodes, all valid** · `npm run build` ✓.

**Headless Chrome, 390×844 (CDP-driven, fresh profile):**
- **First load (cold):** **2.3 s** on localhost to "Smart search ready · runs on your device"; 24 requests, ~52 MB over the wire (onnx 30.7 MB + wasm 14.5 MB ×2 (main+worker) + tokenizer 3.4 MB + vectors/passages 0.6 MB + app ~4 MB incl. fonts/images)
- **Time per question:** median **5–8 ms** (embed 5–9 ms), e.g. "how to apply ration card" → `ration-card-new` 0.887, "rti kaise file kare online" → `rti-first-appeal` 0.730 + passages rti-010/014/019
- **Network per question: 0 requests** in every case (and 0 while asking offline)
- **Offline reload:** killed the server, cold-started Chrome on the same profile → page renders from the service worker, Mini ready, "how do i file rti" → `rti-file` 0.817, 0 network requests
- **Memory:** JS heap ≈ 101–108 MB (threaded) / **72–77 MB single-thread**
- **Single-thread WASM (phones):** served `dist/` with **no COOP/COEP** → `crossOriginIsolated=false` → `numThreads=1` path loads and answers identically (6–7 ms). COOP/COEP headers themselves untouched in `vite.config.js:3-6`.

## Changes (file:line)
- **NEW `src/miniSearch.js`** — local searcher: `/mini-model/` int8 ONNX (L15), tokenizer dir derived from `VITE_MINI_MODEL_URL` (L19), **max length 256** (L20), threads 2/1 (L24), cache-first 33 MB download w/ progress (L31-49), tokenizer check `[22766,25,23748,995,50256]` (L75), same redact→normalize→emergency→script-guard pipeline → best row per card → top 3 → **hybrid passages from `data/index-mini/passages.f32`** (L99-116), `covered` vs `mini_threshold` 0.72 (L113), `source: "local"`
- **NEW `src/MiniMode.jsx`** — auto-loads after first paint, no button (L13-23); exact statuses "Smart search loading (33 MB, once)…" (L29) and "Smart search ready · runs on your device" (L35)
- **`src/main.jsx:20,95-96,105,210-224,296-299,304`** — mode switch; keyword answers until ready (no 2 s server timeout in local), silent swap-in when the Mini becomes ready (L222-229); LiveRoute/mind map/route graph/meaning map all get the Mini (L304); exact wording "Runs on your device. Your question isn't sent anywhere. Works offline after the first load." (L298); Privacy panel rewritten for local (L33-37)
- **`src/PrivateMode.jsx:4,35,44`** — Plan C only: the 560 MB button and its auto-start are dead in local mode (stale localStorage flag can't trigger a 560 MB download)
- **`src/Feedback.jsx:11-15`** — local: no network call; "Report a wrong card" opens a prefilled GitHub issue with the **card id only**; yes/no buttons removed (server mode unchanged, `API_BASE` kept at L18)
- **`public/sw.js:12`** — `/mini-model/` added to cache-first paths
- **`data/search_config.json:3`** — `"mini_threshold": 0.72`
- **`src/SearchResults.jsx:109-113`**, **`src/styles.css:40-41`**, **`.gitignore:18`** (onnx stays out of the repo until the licence check in HANDOFF §12)
- **NEW `scripts/build_meaning_map_mini.py`** → `data/index/meaning_map.json` rebuilt from Mini vectors only (t-SNE, cosine, seed 7; 36+108+159 = 303 points) — `data/index/` vectors untouched

## Notes / caveats
- **First-visit downloads ≈ 52 MB** (in-app browser + cold-profile numbers agree). `dist/` is 97 MB total because Plan C ships too: teacher vectors (295+326 KB), `privateSearch` chunk, `private-model/` tokenizer 3.4 MB — fetched only in server mode.
- Vite also emits unused ORT wasm copies into `dist/assets/` (14.8 + 26.9 MB) — never downloaded in local mode (`wasmPaths='/ort/'`); harmless but could be trimmed later.
- The production tokenizer path (`VITE_MINI_MODEL_URL` dir + `/tokenizer/`) is wired but untested against a real HF URL — flagged for the deploy step (which is blocked on your "go" anyway).
- Not done here, per HANDOFF §12 step 4: the real **Android airplane-mode test** needs an HTTPS preview link and your OK — so the page still doesn't claim "works on phones".