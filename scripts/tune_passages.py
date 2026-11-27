"""Tune passage retrieval on the PRACTICE set only (tests/passages_labelled.json + tests/dev_passages.json).
Never reads tests/passages_final_*.json.

Variants: chunk size (words per chunk, question repeated on each chunk), scoring (embedding, BM25, hybrid
RRF / weighted), and a quote gate (when is a quote allowed to show). Scores are per official passage
(best chunk wins), so labels stay valid when chunks change.

    ../.venv/bin/python scripts/tune_passages.py
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import search_core as core  # noqa: E402

P = json.loads((ROOT / "data/sources/passages.json").read_text())["passages"]
practice = json.loads((ROOT / "tests/passages_labelled.json").read_text())["questions"]
dev = json.loads((ROOT / "tests/dev_passages.json").read_text())
practice += dev.get("questions", dev) if isinstance(dev, dict) else dev
practice = [q for q in practice if q["expected"]]
assert not any(q["id"].startswith("t-") for q in practice), "final test leaked into practice"

from sentence_transformers import SentenceTransformer  # noqa: E402
model = SentenceTransformer(core.MODEL_ID, revision=core.MODEL_REVISION, trust_remote_code=True, device="cpu")
tok = lambda s: [w for w in core.normalize(s).split() if len(w) > 1]


def chunks(size):
    out = []  # (passage index, text)
    for i, p in enumerate(P):
        words = p["text"].split()
        for k in range(0, max(len(words), 1), size):
            out.append((i, f"{p['question']}\n{' '.join(words[k:k + size])}"))
    return out


def bm25(qtoks, docs):
    N = len(docs); avg = sum(map(len, docs)) / N; df = Counter(w for d in docs for w in set(d))
    s = np.zeros(N)
    for j, d in enumerate(docs):
        tf = Counter(d)
        for w in set(qtoks):
            if w in tf:
                s[j] += math.log(1 + (N - df[w] + .5) / (df[w] + .5)) * tf[w] * 2.2 / (tf[w] + 1.2 * (.25 + .75 * len(d) / avg))
    return s


qv = model.encode_query([core.normalize(core.redact(q["q"])[0]) for q in practice], normalize_embeddings=True)
results = []
for size in (220, 120, 70, 40):
    ch = chunks(size)
    cv = model.encode_document([t for _, t in ch], normalize_embeddings=True, batch_size=32)
    ctok = [tok(t) for _, t in ch]
    per_q = []
    for qi, q in enumerate(practice):
        cidx = [c for c, (pi, _) in enumerate(ch) if P[pi]["dept"] == q["dept"]]
        pids = sorted({ch[c][0] for c in cidx})
        e_c, b_c = cv[cidx] @ qv[qi], bm25(tok(q["q"]), [ctok[c] for c in cidx])
        e = {pi: -9.0 for pi in pids}; b = {pi: 0.0 for pi in pids}
        for k, c in enumerate(cidx):
            pi = ch[c][0]; e[pi] = max(e[pi], e_c[k]); b[pi] = max(b[pi], b_c[k])
        per_q.append((q, pids, e, b))

    def score(method):
        ranks, tops = [], []
        for q, pids, e, b in per_q:
            ev, bv = np.array([e[p] for p in pids]), np.array([b[p] for p in pids])
            er, br = (-ev).argsort().argsort() + 1, (-bv).argsort().argsort() + 1
            z = lambda v: (v - v.mean()) / (v.std() + 1e-9)
            if method == "embed": s = ev
            elif method == "bm25": s = bv
            elif method.startswith("rrf"): k = int(method[3:]); s = 1 / (k + er) + 1 / (k + br)
            else: a = float(method[1:]); s = a * z(ev) + (1 - a) * z(bv)
            order = [P[pids[j]]["id"] for j in (-s).argsort()]
            ranks.append(min(order.index(x) + 1 for x in q["expected"]))
            top_e, top_b = P[pids[int(ev.argmax())]]["id"], P[pids[int(bv.argmax())]]["id"]
            tops.append((order[0], top_e, top_b, float(ev.max()), q["expected"]))
        r = np.array(ranks)
        return {"hit1": (r == 1).mean(), "hit3": (r <= 3).mean(), "mrr": (1 / r).mean(), "tops": tops}

    for m in ("embed", "bm25", "rrf10", "rrf30", "rrf60", "w0.3", "w0.5", "w0.7"):
        s = score(m)
        results.append((size, m, s))
        print(f"chunk {size:3d}  {m:6s}  hit@1 {s['hit1']:.2f}  hit@3 {s['hit3']:.2f}  MRR {s['mrr']:.3f}")

best = max(results, key=lambda r: (r[2]["mrr"], r[2]["hit1"]))
print(f"\nBEST on practice: chunk {best[0]}, {best[1]}  hit@1 {best[2]['hit1']:.2f} MRR {best[2]['mrr']:.3f}  (n={len(practice)})")
# Quote gate: show a quote only when embedding and keyword agree on the top passage (and embedding >= t).
print("\nQuote gate on the best setting (precision = shown quotes that are right):")
for t in (0, .70, .72, .74, .76):
    shown = [x for x in best[2]["tops"] if x[1] == x[2] and x[3] >= t]
    right = sum(x[0] in x[4] for x in shown)
    print(f"  agree & embed>={t:.2f}: shown {len(shown)}/{len(best[2]['tops'])}, right {right}/{len(shown)} = {right / max(len(shown), 1):.0%}")
json.dump({"chunk_words": best[0], "method": best[1], "practice_n": len(practice), "hit1": round(float(best[2]["hit1"]), 3),
           "mrr": round(float(best[2]["mrr"]), 3)}, open(ROOT / "tests/passage_tuning_choice.json", "w"), indent=1)
