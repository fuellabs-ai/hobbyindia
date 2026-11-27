"""Build-time embedding of every card and its example questions.

    ../.venv/bin/python scripts/build_index.py

Writes data/index/vectors.f32 (row-major float32, L2-normalized) and data/index/index.json.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import search_core as core  # noqa: E402


def main():
    from sentence_transformers import SentenceTransformer

    cards = core.load_cards()
    guides = core.load_guides({c["id"] for c in cards})
    model = SentenceTransformer(core.MODEL_ID, revision=core.MODEL_REVISION, trust_remote_code=True, device="cpu")

    rows, docs, questions = [], [], []
    for c in cards:
        rows.append({"card": c["id"], "kind": "card"})
        docs.append(core.card_document(c))
    for c in cards:
        for q in c["examples"]:
            rows.append({"card": c["id"], "kind": "example"})
            questions.append(core.normalize(q))

    doc_vecs = model.encode_document(docs, normalize_embeddings=True, convert_to_numpy=True)
    q_vecs = model.encode_query(questions, normalize_embeddings=True, convert_to_numpy=True)
    vecs = np.vstack([doc_vecs, q_vecs]).astype("<f4")

    core.INDEX_DIR.mkdir(parents=True, exist_ok=True)
    vecs.tofile(core.INDEX_DIR / "vectors.f32")
    meta = {
        "model": core.MODEL_ID,
        "revision": core.MODEL_REVISION,
        "dim": int(vecs.shape[1]),
        "rows": rows,
        "content_hash": core.content_hash(),
        "guides": sorted(guides),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (core.INDEX_DIR / "index.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{len(cards)} cards, {len(questions)} example questions -> {vecs.shape} ({len(guides)} reviewed guides)")


if __name__ == "__main__":
    main()
