# HobbyIndia

An independent guide by Fuel Labs that points you to the right official Indian government page for your problem.
**Not a government website.** Not affiliated with the Government of India or any state government.

Emergency: call **112**. Cyber fraud: call **1930** or report at https://cybercrime.gov.in/

## How it works
You describe your problem in your own words: English, Hinglish, Tanglish or Kanglish.
[HobbyLM-Embed](https://huggingface.co/harims95/hobbylm-embed-140m) (140M parameters, 36M active) turns the question into
numbers and finds the closest of 36 service cards and 10 decision flows. People write every card and flow, and every answer
ends at an official government website. **Nothing is generated.**

- **Server mode (default):** the question goes to a small search server (`server/`). No login. Questions are not logged or stored; numbers that look like Aadhaar, phone or PAN are removed first.
- **Private mode (laptops):** the model ([ONNX, 560 MB](https://huggingface.co/fuellabs/hobbylm-embed-140m-onnx)) runs in your browser. Your question isn't sent anywhere. Works offline after the first load.
- If the server is slow or asleep, the browser falls back to keyword search over the same cards.
- Emergencies (violence, theft, fraud) always show 112 and cybercrime.gov.in first.

## Run it yourself
```sh
npm ci && npm run build
python -m venv .venv && .venv/bin/pip install torch -r server/requirements.txt
.venv/bin/python scripts/build_index.py          # after editing data/services.json or a phrase map
STATIC_DIR=dist PYTHONPATH=server .venv/bin/python server/search_server.py   # http://127.0.0.1:8791/
```
To use your own services, edit `data/services.json` and `data/flows.json`, rebuild the index, and restart.

## Tests
`node tests/run_eval.mjs` (20 questions), `node tests/run_eval.mjs <api> fresh_grok.json` (40), `fresh_grok2.json` (20),
`node tests/parity.mjs`, `node tests/check_flows.mjs`, `node tests/fallback.mjs`.
Results on 27 Nov 2026: 75/80 with the correct service in the top 3, 9/9 emergencies.

## Not included
The live site uses two commercial typefaces and government scheme logos that are not ours to redistribute; they are not in
this repo, and the page falls back to the open fonts in `public/fonts`.

## Licence
Code: Apache-2.0. The model belongs to its authors (Apache-2.0).
