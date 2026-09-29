"""Gundam Card Game card catalog — scraped from the official site, stored on disk.

Storage (all under backend/data/, created on first sync):
  cards.json         the catalog: one record per printing (base card + every parallel "_pN" art)
  card_images/       the card images, <print id>.webp (downloaded by the sync, or lazily on first view)

The catalog is read-only reference data used by the Add Card search. The user's own
inventory still lives in Mongo (`items`); an item added from the catalog copies the card's
name / color / type / rarity / set and points its image_url at /api/card-images/<id>.webp.

Refresh it with `python scrape_cards.py` (or the "Sync card database" button in the app,
which calls POST /api/cards/sync).
"""

from __future__ import annotations

import html
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

logger = logging.getLogger(__name__)

SITE = "https://www.gundam-gcg.com"
CARDS_URL = f"{SITE}/en/cards/"
LIST_URL = f"{SITE}/en/cards/index.php?search=true&package={{package}}"
DETAIL_URL = f"{SITE}/en/cards/detail.php?detailSearch={{id}}"
IMAGE_URL = f"{SITE}/en/images/cards/card/{{id}}.webp"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CATALOG_PATH = DATA_DIR / "cards.json"
IMAGE_DIR = DATA_DIR / "card_images"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0 Safari/537.36 GCG-Sales-Tracker"
    ),
    "Accept-Language": "en",
}

# Print ids look like GD01-001, GD01-001_p1, ST11-003, T-029, EXRP-020, R-001_p6.
PRINT_ID_RE = re.compile(r"^[A-Z0-9]{1,6}-\d{2,4}(?:_p\d{1,2})?$")

# Fallback when the package filter can't be read from the site (site order: GD01 … Promotion card).
FALLBACK_PACKAGES: list[tuple[str, str]] = [
    ("616101", "Newtype Rising [GD01]"),
    ("616102", "Dual Impact [GD02]"),
    ("616103", "Steel Requiem [GD03]"),
    ("616104", "Phantom Aria [GD04]"),
    ("616105", "Freedom Ascension [GD05]"),
    ("616001", "Heroic Beginnings [ST01]"),
    ("616002", "Wings of Advance [ST02]"),
    ("616003", "Zeon's Rush [ST03]"),
    ("616004", "SEED Strike [ST04]"),
    ("616005", "Iron Bloom [ST05]"),
    ("616006", "Clan Unity [ST06]"),
    ("616007", "Celestial Drive [ST07]"),
    ("616008", "Flash of Radiance [ST08]"),
    ("616009", "Destiny Ignition [ST09]"),
    ("616010", "Generation Pulse [ST10]"),
    ("616011", "Aquatic Assault [ST11]"),
    ("616012", "Raging Onslaught [ST12]"),
    ("616013", "Silent Barrage [ST13]"),
    ("616014", "Heavy Dominion [ST14]"),
    ("616201", "Eternal Nexus [EB01]"),
    ("616301", "Deck Build Box Freedom Ascension [SC01]"),
    ("616701", "Other Product Card"),
    ("616000", "Edition Beta"),
    ("616801", "Basic Cards"),
    ("616901", "Promotion card"),
]

# --------------------------------------------------------------------------------------
# Parsing (pure functions — unit-tested against saved HTML in tests/fixtures)
# --------------------------------------------------------------------------------------

_PACKAGE_RE = re.compile(r'js-selectBtn-package[^"]*"\s*data-val="(\d+)"\s*>([^<]+)</a>')
_LIST_ID_RE = re.compile(r'detailSearch=([A-Za-z0-9_\-]+)"')
_DATABOX_RE = re.compile(
    r'<dt class="dataTit">(.*?)</dt>\s*<dd class="dataTxt[^"]*">(.*?)</dd>', re.S
)
_CODE_IN_BRACKETS_RE = re.compile(r"\[([A-Z0-9]{2,6})\]")


def _text(fragment: str | None) -> str | None:
    """Strip tags, unescape entities, collapse whitespace; "-" and "" → None."""
    if fragment is None:
        return None
    s = re.sub(r"<br\s*/?>", " / ", fragment)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip().strip("/").strip()
    return None if s in ("", "-") else s


def _div(page: str, cls: str) -> str | None:
    m = re.search(rf'<(?:div|h1)[^>]*class="{cls}"[^>]*>(.*?)</(?:div|h1)>', page, re.S)
    return m.group(1) if m else None


def parse_packages(page: str) -> list[tuple[str, str]]:
    seen: dict[str, str] = {}
    for code, label in _PACKAGE_RE.findall(page):
        seen.setdefault(code, html.unescape(label).strip())
    return list(seen.items())


def parse_list_ids(page: str) -> list[str]:
    out: list[str] = []
    for pid in _LIST_ID_RE.findall(page):
        if PRINT_ID_RE.match(pid) and pid not in out:
            out.append(pid)
    return out


def normalise_rarity(raw: str | None) -> str | None:
    """'LR  +' → 'LR+', 'C ++' → 'C++', 'LKR +' → 'LKR+'."""
    if not raw:
        return None
    return re.sub(r"\s+", "", raw) or None


def normalise_type(raw: str | None) -> str | None:
    """'UNIT' → 'unit', 'EX BASE' → 'ex base', 'UNIT・TOKEN' → 'unit token'."""
    if not raw:
        return None
    return re.sub(r"[\s・･·]+", " ", raw).strip().lower() or None


def normalise_color(raw: str | None) -> str | None:
    if not raw:
        return None
    c = raw.strip().lower()
    return c if c in {"red", "white", "blue", "green", "purple"} else None


def set_code_for(card_no: str, where: str | None) -> str:
    """The set printed on the card (GD01-001 → GD01). Tokens / resources / EX cards have no
    set prefix of their own (T-, R-, EXR-…), so they take the product they come from ([ST13])."""
    prefix = card_no.split("-")[0]
    if re.fullmatch(r"(GD|ST|EB|SC)\d{2}", prefix):
        return prefix
    if where:
        m = _CODE_IN_BRACKETS_RE.search(where)
        if m:
            return m.group(1)
    return prefix


def parse_detail(print_id: str, page: str) -> dict[str, Any] | None:
    name = _text(_div(page, "cardName"))
    if not name:
        return None
    card_no = _text(_div(page, "cardNo")) or print_id.split("_")[0]
    data = {(_text(k) or ""): _text(v) for k, v in _DATABOX_RE.findall(page)}
    where = data.get("Where to get it")
    set_code = set_code_for(card_no, where)
    set_name = None
    if where:
        # "Aquatic Assault [ST11]" → "Aquatic Assault"; keep other labels as-is ("Promotion card").
        set_name = re.sub(r"\s*\[[^\]]+\]\s*$", "", where.split(" / ")[0]).strip() or None
    parallel = re.search(r"_p(\d+)$", print_id)
    return {
        "id": print_id,
        "card_no": card_no,
        "name": name,
        "color": normalise_color(data.get("COLOR")),
        "card_type": normalise_type(data.get("TYPE")),
        "rarity": normalise_rarity(_text(_div(page, "rarity"))),
        "set_code": set_code,
        "set_name": set_name,
        "product": where,
        "parallel": int(parallel.group(1)) if parallel else 0,
        "level": data.get("Lv."),
        "cost": data.get("COST"),
        "ap": data.get("AP"),
        "hp": data.get("HP"),
        "trait": data.get("Trait"),
        "zone": data.get("Zone"),
        "link": data.get("Link"),
        "source_title": data.get("Source Title"),
        "image": f"{print_id}.webp",
    }


# --------------------------------------------------------------------------------------
# Catalog storage + search
# --------------------------------------------------------------------------------------

_lock = threading.Lock()
_cache: dict[str, Any] | None = None  # {"synced_at": iso, "packages": [...], "cards": [...]}


def load_catalog(force: bool = False) -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is None or force:
            if CATALOG_PATH.exists():
                _cache = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
            else:
                _cache = {"synced_at": None, "packages": [], "cards": []}
        return _cache


def save_catalog(catalog: dict[str, Any]) -> None:
    global _cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CATALOG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(CATALOG_PATH)
    with _lock:
        _cache = catalog


def get_card(print_id: str) -> dict[str, Any] | None:
    for card in load_catalog()["cards"]:
        if card["id"] == print_id:
            return card
    return None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


_RELEASE_CODE_RE = re.compile(r"\[([^\]]+)\]\s*$")


def release_key(package_label: str) -> str:
    """A release (the official card list's "package") by its code: "Newtype Rising [GD01]" → "GD01";
    releases without a code keep their name ("Edition Beta", "Promotion card")."""
    m = _RELEASE_CODE_RE.search(package_label)
    return m.group(1).strip() if m else package_label.strip()


def list_releases() -> list[dict[str, Any]]:
    """Releases in the official site's order, with how many printings each has."""
    catalog = load_catalog()
    counts: dict[str, int] = {}
    for card in catalog["cards"]:
        for label in card.get("packages") or []:
            key = release_key(label)
            counts[key] = counts.get(key, 0) + 1
    out = []
    for package in catalog.get("packages") or []:
        key = release_key(package["name"])
        if counts.get(key):
            name = _RELEASE_CODE_RE.sub("", package["name"]).strip()
            out.append({"key": key, "name": name, "count": counts[key]})
    return out


def search_cards(
    q: str = "", set_code: str | None = None, limit: int = 30, release: str | None = None
) -> list[dict[str, Any]]:
    """Name / card-number search. Every word must match; name-prefix hits rank first.

    release: only printings released in that package, e.g. "GD01", "EB01" or "Edition Beta"
    (a reprint belongs to every release it came in, like on the official card list).
    """
    cards = load_catalog()["cards"]
    words = [_norm(w) for w in q.split() if _norm(w)]
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for idx, card in enumerate(cards):
        if set_code and card.get("set_code") != set_code:
            continue
        if release and release not in {release_key(p) for p in card.get("packages") or []}:
            continue
        name = _norm(card["name"])
        ids = _norm(card["id"]) + " " + _norm(card["card_no"])
        if words and not all(w in name or w in ids for w in words):
            continue
        joined = "".join(words)
        score = 0 if not words else (0 if name.startswith(joined) or ids.startswith(joined) else 1)
        scored.append((score, idx, card))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [c for _, _, c in scored[:limit]]


# --------------------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------------------


def image_path(print_id: str) -> Path:
    return IMAGE_DIR / f"{print_id}.webp"


def download_image(print_id: str, session: requests.Session | None = None, force: bool = False) -> bool:
    """Fetch one card image into data/card_images. True when the file is on disk afterwards."""
    if not PRINT_ID_RE.match(print_id):
        return False
    dest = image_path(print_id)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return True
    s = session or requests
    try:
        r = s.get(IMAGE_URL.format(id=print_id), headers=HEADERS, timeout=30)
        if r.status_code != 200 or not r.content:
            return False
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(dest)
        return True
    except requests.RequestException as exc:
        logger.warning("image %s: %s", print_id, exc)
        return False


# --------------------------------------------------------------------------------------
# Sync (scrape the whole site)
# --------------------------------------------------------------------------------------

Progress = Callable[[str, int, int], None]  # (stage, done, total)


def sync_catalog(
    images: bool = True,
    workers: int = 8,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Scrape every package (GD01 … Promotion card), every card detail, and optionally every image."""
    report = progress or (lambda stage, done, total: None)
    session = requests.Session()
    session.headers.update(HEADERS)
    adapter = requests.adapters.HTTPAdapter(pool_connections=workers, pool_maxsize=workers, max_retries=2)
    session.mount("https://", adapter)

    # 1. Packages
    report("packages", 0, 1)
    try:
        packages = parse_packages(session.get(CARDS_URL, timeout=30).text) or FALLBACK_PACKAGES
    except requests.RequestException:
        packages = FALLBACK_PACKAGES
    report("packages", 1, 1)

    # 2. Card ids per package (a printing can appear in several products)
    ids: list[str] = []
    packages_of: dict[str, list[str]] = {}
    for i, (code, label) in enumerate(packages):
        page = session.get(LIST_URL.format(package=code), timeout=30).text
        for pid in parse_list_ids(page):
            if pid not in packages_of:
                ids.append(pid)
                packages_of[pid] = []
            packages_of[pid].append(label)
        report("lists", i + 1, len(packages))

    # 3. Card details
    cards_by_id: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    done = 0

    def fetch(pid: str) -> tuple[str, dict[str, Any] | None]:
        try:
            page = session.get(DETAIL_URL.format(id=pid), timeout=30).text
            return pid, parse_detail(pid, page)
        except requests.RequestException as exc:
            logger.warning("detail %s: %s", pid, exc)
            return pid, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for pid, card in pool.map(fetch, ids):
            done += 1
            if card:
                card["packages"] = packages_of[pid]
                cards_by_id[pid] = card
            else:
                failed.append(pid)
            if done % 25 == 0 or done == len(ids):
                report("details", done, len(ids))

    # Keep previously-known cards that failed this time rather than dropping them.
    if failed:
        previous = {c["id"]: c for c in load_catalog(force=True)["cards"]}
        for pid in failed:
            if pid in previous:
                cards_by_id[pid] = previous[pid]

    cards = [cards_by_id[pid] for pid in ids if pid in cards_by_id]
    catalog = {
        "source": CARDS_URL,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "packages": [{"code": c, "name": n} for c, n in packages],
        "count": len(cards),
        "failed": failed,
        "cards": cards,
    }
    save_catalog(catalog)

    # 4. Images (skips files already on disk)
    if images:
        done = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for _ in pool.map(lambda pid: download_image(pid, session), [c["id"] for c in cards]):
                done += 1
                if done % 25 == 0 or done == len(cards):
                    report("images", done, len(cards))

    return {"count": len(cards), "failed": failed, "synced_at": catalog["synced_at"]}
