"""Chunk official FAQs into passages and embed them with HobbyLM-Embed.

    ../.venv/bin/python scripts/build_passages.py

Reads data/sources/raw/{rti.html, nalsa.html, passport-pv.txt} (fetched 2026-11-27; raw files are not
published), writes data/sources/passages.json and data/index/passages.f32 (L2-normalized, encode_document).
Keep the existing 220-word parent passages (and their labelled ids). Embed 120-word
children with the question repeated, as selected on the practice set. Vector row i
corresponds to chunks[i], not passages[i].
"""
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import search_core as core  # noqa: E402

RAW = ROOT / "data" / "sources" / "raw"
MAX_WORDS = 220
CHUNK_WORDS = core.load_json("search_config.json")["passage_retrieval"]["chunk_words"]
SOURCES = [
    {"dept": "rti", "file": "rti.html", "name": "RTI Online FAQ", "url": "https://rtionline.gov.in/faq.php", "cards": ["rti-file", "rti-first-appeal"]},
    {"dept": "passport", "file": "passport-pv.txt", "name": "Passport Seva: police verification FAQ", "url": "https://www.passportindia.gov.in/psp/FaqPoliceVerification", "cards": ["passport"]},
    {"dept": "legal-aid", "file": "nalsa.html", "name": "NALSA FAQ", "url": "https://nalsa.gov.in/faqs/", "cards": ["free-legal-aid"]},
]
# Keep the published RTI/NALSA ids stable when another source gains passages.
ID_STARTS = {"rti": 0, "passport": 26, "legal-aid": 40}


def lines_of(path):
    t = path.read_text(errors="ignore")
    if path.suffix == ".html":
        t = re.sub(r"<(script|style|nav|footer|header)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
        t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return [re.sub(r"\s+", " ", l).strip() for l in t.splitlines() if len(l.strip()) > 2]


def qa_pairs(lines):
    pairs, q, ans = [], None, []
    for l in lines:
        if l.endswith("?") and len(l.split()) >= 4:
            if q and ans:
                pairs.append((q, " ".join(ans)))
            q, ans = l, []
        elif q:
            ans.append(l)
    if q and ans:
        pairs.append((q, " ".join(ans)))
    return pairs


def passport_pairs(path):
    """Parse an expanded FAQ capture with explicit Q:/A: boundaries.

    Collapsed page innerText contains questions and category headings, but no
    answers. Refuse that capture rather than indexing headings such as 'Minor'.
    Explicit boundaries also keep question marks inside table/list answers from
    starting a new question. Table rows and list items remain part of the answer.
    """
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"(?m)^Q:\s*", text)[1:]
    if not blocks:
        raise ValueError(f"{path.name}: collapsed FAQ; recapture expanded answers as Q:/A: blocks")
    pairs = []
    for block in blocks:
        parts = re.split(r"(?m)^A:\s*", block, maxsplit=1)
        if len(parts) != 2:
            raise ValueError(f"{path.name}: question without an answer")
        question, answer = (re.sub(r"\s+", " ", part).strip() for part in parts)
        if not question.endswith("?") or len(answer.split()) < 5:
            raise ValueError(f"{path.name}: incomplete FAQ answer")
        pairs.append((question, answer))
    return pairs


def chunk_passages(passages, size=CHUNK_WORDS):
    if size < 1:
        raise ValueError("chunk size must be positive")
    chunks = []
    for passage in passages:
        words = passage["text"].split()
        parts = [" ".join(words[i:i + size]) for i in range(0, len(words), size)] or [""]
        for i, text in enumerate(parts):
            chunks.append({"id": f"{passage['id']}:chunk-{i + 1}", "parent_id": passage["id"],
                           "text": text, "part": i + 1, "parts": len(parts)})
    return chunks


def main():
    passages = []
    for s in SOURCES:
        pairs = passport_pairs(RAW / s["file"]) if s["dept"] == "passport" else qa_pairs(lines_of(RAW / s["file"]))
        source_passages = []
        for q, a in pairs:
            q = re.sub(r"^\d+\.\s*", "", q)
            words = a.split()
            parts = [" ".join(words[i:i + MAX_WORDS]) for i in range(0, len(words), MAX_WORDS)] or [""]
            for k, part in enumerate(parts):
                source_passages.append({"id": f"{s['dept']}-{ID_STARTS[s['dept']] + len(source_passages):03d}", "dept": s["dept"], "cards": s["cards"], "source": s["name"],
                                 "url": s["url"], "question": q, "text": part, "part": k + 1, "parts": len(parts)})
        passages.extend(source_passages)
    chunks = chunk_passages(passages)
    parents = {p["id"]: p for p in passages}
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(core.MODEL_ID, revision=core.MODEL_REVISION, trust_remote_code=True, device="cpu")
    vecs = model.encode_document([f"{parents[c['parent_id']]['question']}\n{c['text']}" for c in chunks], normalize_embeddings=True, convert_to_numpy=True, batch_size=32)
    vecs.astype("<f4").tofile(core.INDEX_DIR / "passages.f32")
    out = {"fetched_on": "2026-11-27", "built_on": date.today().isoformat(), "dim": int(vecs.shape[1]),
           "note": "Short excerpts of official FAQs, shown with a link to the source. Rights remain with the publishers.",
           "chunk_words": CHUNK_WORDS, "passages": passages, "chunks": chunks}
    (ROOT / "data" / "sources" / "passages.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for s in SOURCES:
        n = [p for p in passages if p["dept"] == s["dept"]]
        print(f"{s['dept']}: {len(n)} passages ({len({p['question'] for p in n})} questions), {sum(len(p['text'].split()) for p in n)} words")
    print(f"{len(chunks)} indexed chunks, at most {CHUNK_WORDS} answer words each; parent ids unchanged")


if __name__ == "__main__":
    main()
