"""2D "meaning map" of everything HobbyLM-Embed searches: 36 cards, their 108 example
questions and the official FAQ passages. t-SNE (cosine) on the real 512-d vectors, so
things that mean similar things land near each other. Output: data/index/meaning_map.json.

    ../.venv/bin/python scripts/build_meaning_map.py

The layout is for explanation only; search itself always uses the full 512-d vectors.
"""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.manifold import TSNE

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import search_core as core  # noqa: E402


def main():
    meta = json.loads((core.INDEX_DIR / "index.json").read_text())
    cards = {c["id"]: c for c in core.load_cards()}
    vecs = np.fromfile(core.INDEX_DIR / "vectors.f32", dtype="<f4").reshape(len(meta["rows"]), meta["dim"])
    passage_data = json.loads((ROOT / "data" / "sources" / "passages.json").read_text())
    passages, chunks = passage_data["passages"], passage_data["chunks"]
    parents = {p["id"]: p for p in passages}
    pvecs = np.fromfile(core.INDEX_DIR / "passages.f32", dtype="<f4").reshape(len(chunks), meta["dim"])

    points, ex_seen = [], {}
    for r in meta["rows"]:
        if r["kind"] == "card":
            points.append({"kind": "card", "card": r["card"], "text": cards[r["card"]]["title"]})
        else:
            k = ex_seen.get(r["card"], 0); ex_seen[r["card"]] = k + 1
            points.append({"kind": "example", "card": r["card"], "text": cards[r["card"]]["examples"][k]})
    for chunk in chunks:
        p = parents[chunk["parent_id"]]
        points.append({"kind": "passage", "card": p["cards"][0], "passage": p["id"], "chunk": chunk["id"], "text": p["question"]})

    allv = np.vstack([vecs, pvecs])
    xy = TSNE(n_components=2, metric="cosine", perplexity=25, init="pca", random_state=7, max_iter=2000).fit_transform(allv)
    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))
    for p, (x, y) in zip(points, xy):
        p["x"], p["y"] = round(float(x), 4), round(float(y), 4)
    out = {"method": "t-SNE (cosine, perplexity 25, seed 7) of HobbyLM-Embed vectors; for explanation only",
           "counts": {k: sum(p["kind"] == k for p in points) for k in ("card", "example", "passage")},
           "parent_passages": len(passages), "points": points}
    (core.INDEX_DIR / "meaning_map.json").write_text(json.dumps(out, ensure_ascii=False) + "\n")
    print(out["counts"], len(points), "points")


if __name__ == "__main__":
    main()
