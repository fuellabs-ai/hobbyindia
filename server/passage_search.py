"""The practice-selected passage retriever. Never retains query text.

Match scripts/tune_passages.py: normalize/truncate document tokens, retain stop
words, BM25 over child chunks within the department, max-pool each channel to
parent passages, then 0.7*z(embedding) + 0.3*z(BM25), population std + 1e-9.
"""
import math
from collections import Counter

import numpy as np

import search_core as core


def tokens(text):
    return [word for word in core.normalize(text).split() if len(word) > 1]


class PassageSearch:
    def __init__(self, meta, vectors, config):
        self.parents = meta["passages"]
        self.chunks = meta["chunks"]
        self.vectors = vectors
        self.config = config
        if meta["chunk_words"] != config["passage_retrieval"]["chunk_words"]:
            raise ValueError("passage chunks do not match the retrieval configuration")
        if len(vectors) != len(self.chunks):
            raise ValueError("passage vectors do not match chunk metadata")
        parent_col = {p["id"]: i for i, p in enumerate(self.parents)}
        if len(parent_col) != len(self.parents):
            raise ValueError("duplicate parent passage id")
        self.row_parent = np.array([parent_col[c["parent_id"]] for c in self.chunks])
        self.department_by_card = {cid: p["dept"] for p in self.parents for cid in p["cards"]}
        self.departments = {}
        for dept in set(self.department_by_card.values()):
            rows = np.array([i for i, pi in enumerate(self.row_parent) if self.parents[pi]["dept"] == dept])
            parents = sorted(set(self.row_parent[rows]))
            docs = [tokens(f"{self.parents[self.row_parent[i]]['question']}\n{self.chunks[i]['text']}") for i in rows]
            self.departments[dept] = {
                "rows": rows, "parents": parents, "tf": [Counter(doc) for doc in docs],
                "lengths": [len(doc) for doc in docs],
                "average": sum(map(len, docs)) / len(docs),
                "df": Counter(word for doc in docs for word in set(doc)),
            }

    def rank(self, cleaned, query, dept):
        group = self.departments.get(dept)
        if not group:
            return {"embedding": [], "keyword": [], "hybrid": [], "compared": 0, "parents_compared": 0, "quote_eligible": False}
        rows, parents = group["rows"], group["parents"]
        # cleaned is already normalize(redact(raw)); do not normalize it twice.
        terms = set(word for word in cleaned.split() if len(word) > 1)
        b_chunks = np.zeros(len(rows))
        for i, tf in enumerate(group["tf"]):
            for word in terms:
                if word in tf:
                    df = group["df"][word]
                    b_chunks[i] += math.log(1 + (len(rows) - df + .5) / (df + .5)) * tf[word] * 2.2 / (tf[word] + 1.2 * (.25 + .75 * group["lengths"][i] / group["average"]))
        b = np.zeros(len(parents))
        e = np.full(len(parents), -np.inf)
        col = {pi: i for i, pi in enumerate(parents)}
        e_chunks = self.vectors[rows] @ query if query is not None else None
        for i, row in enumerate(rows):
            pi = col[self.row_parent[row]]
            b[pi] = max(b[pi], b_chunks[i])
            if e_chunks is not None:
                e[pi] = max(e[pi], e_chunks[i])
        z = lambda values: (values - values.mean()) / (values.std() + 1e-9)
        weights = self.config["passage_retrieval"]
        hybrid = weights["embedding_weight"] * z(e) + weights["bm25_weight"] * z(b) if query is not None else None
        agree = query is not None and int(e.argmax()) == int(b.argmax()) and b.max() > 0 and e.max() >= self.config["passage_threshold"]
        eligible = int(e.argmax()) if agree else None
        result = {"compared": len(rows), "parents_compared": len(parents), "quote_eligible": bool(agree)}
        for method, scores in (("embedding", e if query is not None else None), ("keyword", b), ("hybrid", hybrid)):
            order = sorted(range(len(parents)), key=lambda i: (-float(scores[i]), i)) if scores is not None else []
            result[method] = [{"id": self.parents[parents[i]]["id"], "score": float(scores[i]),
                               "embedding_score": float(e[i]) if query is not None else None,
                               "bm25_score": float(b[i]), "quote_eligible": i == eligible} for i in order]
        return result

    def response(self, ranked):
        """Keep cosine in score for existing UI clients; hybrid_score orders rows.

        Threshold 2 closes the old score-only UI gate (cosine is at most 1).
        Keyword-only results cannot meet a two-model agreement gate.
        """
        hybrid = bool(ranked["hybrid"])
        eligible = hybrid and ranked["quote_eligible"]
        out = []
        for row in (ranked["hybrid"] if hybrid else ranked["keyword"])[:3]:
            score = row["embedding_score"] if hybrid else row["bm25_score"] / (row["bm25_score"] + 1)
            item = {"id": row["id"], "score": round(score, 4), "bm25_score": round(row["bm25_score"], 4),
                    "quote_eligible": row["quote_eligible"] if hybrid else False}
            if hybrid:
                item["hybrid_score"] = round(row["score"], 4)
            out.append(item)
        return {"passages": out, "passages_compared": ranked["compared"], "passage_parents_compared": ranked["parents_compared"],
                "passage_method": "hybrid" if hybrid else "bm25" if out else "none", "quote_eligible": bool(eligible),
                "passage_threshold": self.config["passage_threshold"] if eligible else 2}
