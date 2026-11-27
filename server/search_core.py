"""Shared search logic for the build step and the /api/search server.

Normalization must stay identical to src/search.js (normalize, redact, isEmergency).
"""
import hashlib
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
INDEX_DIR = DATA / "index"
MODEL_ID = "harims95/hobbylm-embed-140m"
MODEL_REVISION = "ea708cee107818fa0c1871eebd26d82a1e3fb1aa"
MAX_QUERY_CHARS = 300


def load_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def load_cards():
    cards = load_json("services.json")["cards"]
    ids = [c["id"] for c in cards]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate card id")
    for c in cards:
        for field in ("id", "title", "summary", "official_name", "official_url", "examples"):
            if not c.get(field):
                raise ValueError(f"card {c.get('id')} missing {field}")
        if not c["official_url"].startswith("https://"):
            raise ValueError(f"card {c['id']} official_url must be https")
    return cards


def load_guides(card_ids):
    """Only guides with two named reviewers and a future review date count."""
    guides = {}
    for path in sorted((DATA / "guides").glob("*.json")):
        g = json.loads(path.read_text(encoding="utf-8"))
        cid = g.get("card_id")
        if cid not in card_ids:
            raise ValueError(f"{path.name}: unknown card_id {cid}")
        if len([r for r in g.get("reviewed_by", []) if r.strip()]) < 2:
            raise ValueError(f"{path.name}: needs two reviewers")
        if date.fromisoformat(g["next_review"]) < date.today():
            raise ValueError(f"{path.name}: review expired")
        guides[cid] = g
    return guides


# Romanized phrase maps, applied in this order; the first map wins on a clash.
PHRASE_MAPS = ("hinglish_map.json", "tanglish_map.json", "kanglish_map.json")
_hinglish = {}
for _name in PHRASE_MAPS:
    for _k, _v in load_json(_name)["phrases"].items():
        _hinglish.setdefault(_k, _v)
_phrases = sorted(_hinglish, key=len, reverse=True)
_hinglish_re = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(p) for p in _phrases) + r")(?![a-z0-9])")
_emergency = load_json("emergency.json")
# re.ASCII makes \b, \w and \d ASCII-only, matching JavaScript's regex semantics exactly.
_emergency_res = [re.compile(p, re.ASCII) for p in _emergency["patterns"]]

# Personal data never helps routing: drop it before embedding, caching or anything else.
# Keep identical to PII in src/search.js (tests/parity.mjs checks this).
_PII = [
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.]+"),             # email
    re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])"),  # PAN
    re.compile(r"(?:\+?[0-9][\s().-]*){6,}"),  # 6+ digits, any spacing/brackets: phone, Aadhaar, account
]


def redact(text):
    """Returns (text, had_pii)."""
    found = False
    for rx in _PII:
        text, n = rx.subn(" ", text)
        found = found or n > 0
    return text, found


def normalize(text):
    t = text.lower()[:MAX_QUERY_CHARS]  # code points, like Array.from in JS
    t = re.sub(r"[\u2019'`]", "", t)
    t = re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", t)
    t = _hinglish_re.sub(lambda m: f" {_hinglish[m.group(1)]} ", t)
    return re.sub(r"\s+", " ", t).strip()


def is_emergency(raw, normalized):
    low = re.sub(r"\s+", " ", raw.lower())
    return any(rx.search(low) or rx.search(normalized) for rx in _emergency_res)


def indic_script(text):
    """True when most letters are Indian scripts (Devanagari..Malayalam). HobbyLM-Embed
    does not handle these: Tamil and Kannada queries all collapse onto one card at 0.71."""
    letters = [ch for ch in text if ch.isalpha()]
    return bool(letters) and sum("\u0900" <= ch <= "\u0dff" for ch in letters) / len(letters) > 0.3


def card_document(card):
    return f"{card['title']}. {card['summary']} Official service: {card['official_name']}."


def content_hash():
    h = hashlib.sha256()
    for name in ("services.json",) + PHRASE_MAPS:
        h.update((DATA / name).read_bytes())
    return h.hexdigest()[:16]
