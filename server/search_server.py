"""Small /api/search endpoint: embeds the question, returns top-3 card ids with scores.

    ../.venv/bin/python server/search_server.py            # 127.0.0.1:8791

Env: HOST, PORT, ALLOW_ORIGIN, TRUST_PROXY=1 (use first X-Forwarded-For hop as client IP),
RATE_PER_MIN (default 30), RATE_BURST (default 10), CACHE_SIZE (default 5000).

Privacy: question text and client IPs are never logged or written to disk. Questions that
contain personal data patterns are redacted before embedding and never cached. Rate-limit
buckets hold only an IP and a token count, in memory.
"""
import json
import os
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

import search_core as core

THRESHOLD = core.load_json("search_config.json")["threshold"]  # shared with src/privateSearch.js
TOP_K = 3
RATE_PER_MIN = float(os.environ.get("RATE_PER_MIN", 300))  # Indian mobile users often share one IP (carrier NAT)
RATE_BURST = float(os.environ.get("RATE_BURST", 60))
CACHE_SIZE = int(os.environ.get("CACHE_SIZE", 5000))
ALLOW_ORIGINS = {o.strip() for o in os.environ.get("ALLOW_ORIGIN", "http://127.0.0.1:4173,http://127.0.0.1:8791").split(",") if o.strip()}
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"
STATIC_DIR = os.environ.get("STATIC_DIR")      # serve the built site (Docker / HF Space)
MODEL_DIR = os.environ.get("MODEL_DIR")        # local testing only: serve the private-mode ONNX at /models/
FEEDBACK_FILE = os.environ.get("FEEDBACK_FILE", str(core.ROOT / "feedback_counts.json"))
VOTES = ("yes", "no", "wrong")
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
        ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm", ".f32": "application/octet-stream",
        ".onnx": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8"}


class Feedback:
    """Counts only: {card_id: {"yes": n, "no": n, "wrong": n}}. No question text, no IP, no time."""
    def __init__(self):
        self.lock = threading.Lock()
        try:
            self.counts = json.loads(open(FEEDBACK_FILE).read())
        except (OSError, ValueError):
            self.counts = {}

    def add(self, card, vote):
        with self.lock:
            self.counts.setdefault(card, {v: 0 for v in VOTES})[vote] += 1
            tmp = FEEDBACK_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.counts, f)
            os.replace(tmp, FEEDBACK_FILE)


class Index:
    def __init__(self, model=None):
        meta = json.loads((core.INDEX_DIR / "index.json").read_text())
        if meta["revision"] != core.MODEL_REVISION or meta["content_hash"] != core.content_hash():
            raise SystemExit("index is stale: run scripts/build_index.py")
        self.vecs = np.fromfile(core.INDEX_DIR / "vectors.f32", dtype="<f4").reshape(len(meta["rows"]), meta["dim"])
        self.card_ids = [c["id"] for c in core.load_cards()]
        col = {cid: i for i, cid in enumerate(self.card_ids)}
        self.row_card = np.array([col[r["card"]] for r in meta["rows"]])
        if model is None:
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer(core.MODEL_ID, revision=core.MODEL_REVISION, trust_remote_code=True, device="cpu")
        self.model = model
        self.lock = threading.Lock()
        self.scores("warm up")  # first encode is slow; pay it before serving

    def scores(self, normalized):
        with self.lock:
            q = self.model.encode_query([normalized], normalize_embeddings=True, convert_to_numpy=True)[0]
        sims = self.vecs @ q
        best = np.full(len(self.card_ids), -1.0)
        np.maximum.at(best, self.row_card, sims)  # card score = best of its card text and example questions
        return best

    def search(self, raw):
        text, had_pii = core.redact(raw)
        normalized = core.normalize(text)
        emergency = core.is_emergency(raw, normalized)
        if core.indic_script(raw):
            return {"emergency": emergency, "covered": False, "reason": "script_unsupported", "threshold": THRESHOLD, "results": []}, had_pii
        if not normalized:
            return {"emergency": emergency, "covered": False, "threshold": THRESHOLD, "results": []}, had_pii
        best = self.scores(normalized)
        order = np.argsort(-best)[:TOP_K]
        results = [{"id": self.card_ids[i], "score": round(float(best[i]), 4)} for i in order]
        return {"emergency": emergency, "covered": results[0]["score"] >= THRESHOLD, "threshold": THRESHOLD, "results": results}, had_pii


class Limiter:
    def __init__(self):
        self.buckets, self.lock = {}, threading.Lock()

    def allow(self, ip):
        now = time.monotonic()
        with self.lock:
            tokens, last = self.buckets.get(ip, (RATE_BURST, now))
            tokens = min(RATE_BURST, tokens + (now - last) * RATE_PER_MIN / 60)
            ok = tokens >= 1
            self.buckets[ip] = (tokens - 1 if ok else tokens, now)
            if len(self.buckets) > 50000:  # drop idle buckets
                self.buckets = {k: v for k, v in self.buckets.items() if now - v[1] < 120}
            return ok


class Cache:
    def __init__(self):
        self.data, self.lock = OrderedDict(), threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]

    def put(self, key, value):
        with self.lock:
            self.data[key] = value
            if len(self.data) > CACHE_SIZE:
                self.data.popitem(last=False)


def make_handler(index):
    limiter, cache, feedback = Limiter(), Cache(), Feedback()
    static_root = os.path.realpath(STATIC_DIR) if STATIC_DIR else None
    model_root = os.path.realpath(MODEL_DIR) if MODEL_DIR else None

    class Handler(BaseHTTPRequestHandler):
        server_version = "search"
        sys_version = ""

        def log_message(self, fmt, *args):  # fixed route label + status only: no IP, no path, no query
            route = {"/search": "search", "/api/search": "search", "/health": "health", "/api/health": "health", "/api/feedback": "feedback"}.get(self.path, "static" if self.command == "GET" else "other")
            status = args[1] if len(args) > 1 and str(args[1]).isdigit() else "-"
            sys.stderr.write(f"{self.command} {route} {status}\n")

        def send(self, status, body, extra=()):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.cors()
            self.send_header("Vary", "Origin")
            for k, v in extra:
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
            self.end_headers()

        def cors(self):
            origin = self.headers.get("Origin", "")
            if origin in ALLOW_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Cross-Origin-Resource-Policy", "cross-origin")

        def isolation_headers(self):
            # Lets private mode use several CPU threads (cross-origin isolation).
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")

        def send_file(self, root, rel, cache_seconds):
            path = os.path.realpath(os.path.join(root, rel.lstrip("/")))
            if not path.startswith(root + os.sep) or not os.path.isfile(path):
                return False
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(os.path.splitext(path)[1], "application/octet-stream"))
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", f"public, max-age={cache_seconds}" if cache_seconds else "no-cache")
            self.isolation_headers()
            self.end_headers()
            with open(path, "rb") as f:
                while chunk := f.read(1 << 20):
                    self.wfile.write(chunk)
            return True

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/health", "/api/health"):
                return self.send(200, {"ok": True, "cards": len(index.card_ids), "revision": core.MODEL_REVISION})
            if model_root and path.startswith("/models/") and self.send_file(model_root, path[len("/models/"):], 86400):
                return
            if static_root and not path.startswith("/api/"):
                rel = "index.html" if path in ("", "/") else path
                long_cache = path.startswith("/assets/")  # content-hashed by Vite
                if self.send_file(static_root, rel, 31536000 if long_cache else 0) or self.send_file(static_root, "index.html", 0):
                    return
            self.send(404, {"error": "not found"})

        def do_POST(self):
            if self.path == "/api/feedback":
                return self.post_feedback()
            if self.path not in ("/search", "/api/search"):
                return self.send(404, {"error": "not found"})
            ip = self.client_address[0]
            if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
                ip = self.headers["X-Forwarded-For"].split(",")[-1].strip()
            if not limiter.allow(ip):
                return self.send(429, {"error": "rate_limited"}, [("Retry-After", "10")])
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self.send(400, {"error": "bad_length"})
            if length < 0 or length > 2048:
                return self.send(413, {"error": "too_large"})
            try:
                q = str(json.loads(self.rfile.read(length) or b"{}").get("q", "")).strip()
            except (ValueError, AttributeError):
                return self.send(400, {"error": "bad_json"})
            if not q:
                return self.send(400, {"error": "empty"})
            # Key only from redacted text, so personal data can never become a cache key.
            redacted, _ = core.redact(q)
            key = (core.indic_script(q), core.normalize(redacted))
            hit = cache.get(key)
            if hit is not None:
                # Safety fields are recomputed for every request, never taken from the cache.
                return self.send(200, {**hit, "emergency": core.is_emergency(q, core.normalize(redacted))}, [("X-Cache", "hit")])
            started = time.perf_counter()
            body, had_pii = index.search(q)
            body["ms"] = round((time.perf_counter() - started) * 1000)
            if not had_pii:
                cache.put(key, body)
            self.send(200, body, [("X-Cache", "miss")])

        def post_feedback(self):
            ip = self.client_address[0]
            if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
                ip = self.headers["X-Forwarded-For"].split(",")[-1].strip()
            if not limiter.allow(ip):
                return self.send(429, {"error": "rate_limited"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(min(length, 256)) or b"{}")
                card, vote = str(body.get("card", "")), str(body.get("vote", ""))
            except (ValueError, AttributeError):
                return self.send(400, {"error": "bad_json"})
            if card not in index.card_ids or vote not in VOTES:
                return self.send(400, {"error": "bad_feedback"})
            feedback.add(card, vote)
            self.send(200, {"ok": True})

    return Handler


def main():
    index = Index()
    host, port = os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", 8791))
    server = ThreadingHTTPServer((host, port), make_handler(index))
    print(f"search on http://{host}:{port} ({len(index.card_ids)} cards, threshold {THRESHOLD})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
