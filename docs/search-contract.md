# Search result contract (server, private mode, keyword fallback)

Every search path returns the same JSON shape, so the route graph and passages UI work in all three modes.
Owners: Codex implements the fields in `server/search_server.py`, `src/privateSearch.js`, `src/search.js`.
Claude builds `src/RouteGraph.jsx` against this contract.

```jsonc
{
  "source": "embedding" | "private" | "keyword" | "local",
  "emergency": false,
  "covered": true,
  "ambiguous": false,                 // keyword only
  "reason": "script_unsupported",     // optional
  "threshold": 0.70,
  "cleaned": "ration card how to apply",          // normalize(redact(q)); never logged or stored
  "removed_personal_data": false,                 // true if redact() removed anything
  "timing_ms": { "embed": 41, "total": 61 },      // keyword: embed = 0
  "compared": 144,                                // vectors compared (cards + examples); keyword: number of cards
  "results": [                                    // top 3
    { "id": "ration-card-new", "score": 0.8538,
      "via": "example",                          // "card" | "example" | "keyword"
      "matched": "How do I apply for a new ration card?" }   // the card title or example question that scored best
  ],
  "passages": [                                   // only when results[0] is in a chunked department; else []
    { "id": "rti-012", "score": 0.81 }            // top 3 within that department's passages, best first
  ],
  "passages_compared": 26
}
```

Rules
- `cleaned` and `matched` are returned to the asker only. Never log, cache-key or store question text (cache keys stay redacted).
- Passage text, question, source name and URL come from `data/sources/passages.json` in the browser (not sent by the API).
- Chunked departments: cards `rti-file`, `rti-first-appeal` -> dept `rti`; `passport` -> `passport`; `free-legal-aid` -> `legal-aid`.
- A passage is shown to the user only if its score >= `passage_threshold` in `data/search_config.json` (Codex sets it from dev data, never from the test set).

## Practice-selected hybrid retrieval (27 Nov 2026)

- `passages.json.passages` retains the 141 labelled parent ids and texts. `chunks`
  contains their 120-word children (`parent_id`, `text`, `part`, `parts`). Vector
  row i in `passages.f32` is `chunks[i]`. Parents are not re-numbered.
- Within the top card's department, take each parent's maximum child cosine and
  maximum child BM25 independently. Rank parents by
  `0.7 * z(cosine) + 0.3 * z(BM25)`, population standard deviation plus `1e-9`.
  BM25 uses normalized document text (including the existing 300-code-point
  truncation), keeps stop words, and uses k1=1.2, b=0.75, exactly as practice tuning.
- Server/private results use `passage_method: "hybrid"`. `passages[].score` stays
  the parent's cosine for compatibility; `hybrid_score` is the actual sort score,
  and `bm25_score` is the unbounded keyword score. Scores need not decrease in
  cosine order. Results always contain unique parent ids, never child ids.
- `passages_compared` counts child vectors/documents; `passage_parents_compared`
  counts unique parents. Keyword fallback uses the same BM25 child scoring and
  parent pooling, with `passage_method: "bm25"` and bounded BM25 in `score`.
- `quote_eligible` is true only when embedding and BM25 agree on the top parent,
  there is positive keyword evidence, and cosine meets the configured minimum
  (0 for the selected agreement-only gate). Only that top result is eligible.
  Keyword-only search cannot satisfy agreement.
- The response's `passage_threshold` is 2 when the gate is closed, so existing
  score-only UI clients show no passage; otherwise it is the configured minimum.
  Updated clients should also check `quote_eligible`. Guards return the same
  fields, with empty passages and `quote_eligible: false`.
- This gate is an experimental eligibility signal, not approval to show quotes.
  `SHOW_OFFICIAL_QUOTES` remains false until the independently labelled and
  spot-checked final test is run once and shown-quote precision is sufficient.
