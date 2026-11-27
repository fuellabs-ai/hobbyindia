# release/web: the approved HobbyIndia site (deploy this folder)

This is the finished site the team approved and demoed (the "Before Codex" layout plus the 27–28 Nov fixes).
It is a built bundle: deploy the folder as static files (e.g. `vercel deploy release/web`). There is no server.

## Not in git: add these before deploying
| Path | Why it is missing |
|---|---|
| `mini-model/hobbylm-embed-mini.int8.onnx` (29.3 MB, SHA-256 starts `c05719fe9806`) | Licence OK on training shards pending |
| `fonts/helvetica-now-*.woff2`, `fonts/rhymes-text.woff2` | Commercial fonts, no redistribution licence |
| `logos/` | Government scheme logos, permission pending |

Without the `.onnx` the site still works with keyword search only. Without the fonts it falls back to Georgia/Arial.

## Changes on top of the original build
- `assets/index-*.js`: top strip shows Emergency 112 only; collage note reworded.
- `assets/miniSearch-*.js`: offline saving reads each file fully before `Cache.put` (large files failed when saved from the stream), with one retry.
- `sw.js`: deadline only on page loads; big static files are cache-first; cache name recovered after a worker restart.
- `compact.css` / `compact.js` (linked from `index.html`): homepage order hero → service cards → statement → map of meaning; map of meaning restyled as a grey panel with a floating full map; the "Describe what you need…" bar runs the real on-device search.

## Checked locally (28 Nov)
- Privacy: 0 requests contain the question text, 0 POSTs, 0 `/api/` calls.
- Offline: after the first visit, reload with no network and the Mini still answers.
- Not yet checked: Android phone (Hari's test).
