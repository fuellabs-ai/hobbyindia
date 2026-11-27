"""Pick the coverage threshold on dev data only (never tests/questions.json).

In-scope: each card example question, scored with its own vector removed (leave-one-out).
Out-of-scope: tests/dev_threshold.json. Prints both distributions and a threshold sweep.
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import search_core as core  # noqa: E402
from search_server import Index  # noqa: E402

idx = Index()
meta = json.loads((core.INDEX_DIR / "index.json").read_text())
cards = core.load_cards()
examples = [(c["id"], q) for c in cards for q in c["examples"]]
ex_rows = [i for i, r in enumerate(meta["rows"]) if r["kind"] == "example"]

inscope, correct = [], 0
for (cid, q), row in zip(examples, ex_rows):
    qv = idx.model.encode_query([core.normalize(q)], normalize_embeddings=True, convert_to_numpy=True)[0]
    sims = idx.vecs @ qv
    sims[row] = -1  # leave own vector out
    best = np.full(len(idx.card_ids), -1.0)
    np.maximum.at(best, idx.row_card, sims)
    top = int(np.argmax(best))
    correct += idx.card_ids[top] == cid
    inscope.append(float(best[top]))

offtopic = []
for q in json.loads((ROOT / "tests/dev_threshold.json").read_text())["not_covered"]:
    best = idx.scores(core.normalize(q))
    offtopic.append((float(best.max()), q, idx.card_ids[int(best.argmax())]))

print(f"leave-one-out top-1 accuracy on examples: {correct}/{len(examples)}")
print("in-scope top score  min %.3f  p10 %.3f  median %.3f" % (min(inscope), np.percentile(inscope, 10), np.median(inscope)))
print("off-topic top score max %.3f  median %.3f" % (max(s for s, *_ in offtopic), np.median([s for s, *_ in offtopic])))
for s, q, c in sorted(offtopic, reverse=True)[:8]:
    print(f"  {s:.3f}  {q!r} -> {c}")
print("\nthreshold  in-scope kept  off-topic rejected")
for t in np.arange(0.50, 0.80, 0.02):
    print(f"  {t:.2f}     {sum(s >= t for s in inscope):3d}/{len(inscope)}         {sum(s < t for s, *_ in offtopic):2d}/{len(offtopic)}")
