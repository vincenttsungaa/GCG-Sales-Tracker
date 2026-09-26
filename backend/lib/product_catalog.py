"""Gundam Card Game product catalog (starter decks, accessories, Premium Bandai, other).

Scraped from https://www.gundam-gcg.com/en/products/list.php?page=N — every product except
BOOSTER PACK — and stored like the card catalog:
  data/products.json        the catalog
  data/product_images/      <product id>.webp (the list thumbnail)

Used by the Add Item search. Refresh with `python scrape_cards.py --products` or the
"Update" link in Add Item (POST /api/products/sync).
"""

from __future__ import annotations

import html
import json
import logging
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urljoin

import requests

from lib.card_catalog import DATA_DIR, HEADERS, SITE

logger = logging.getLogger(__name__)

LIST_URL = f"{SITE}/en/products/list.php?page={{page}}"
CATALOG_PATH = DATA_DIR / "products.json"
IMAGE_DIR = DATA_DIR / "product_images"

EXCLUDED_TAGS = {"BOOSTERPACK"}
MAX_PAGES = 50

# Site tag → the item category stored on inventory items.
TAG_TO_CATEGORY = {
    "STARTERDECK": "starter deck",
    "ACCESSORIES": "accessories",
    "PREMIUMBANDAI": "premium bandai",
    "OTHER": "other",
}

PRODUCT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,40}$")

_BLOCK_SPLIT = re.compile(r'<div class="productsDetail"')
_TAGS_RE = re.compile(r'^\s*data-tags="([^"]*)"')
_HREF_RE = re.compile(r'<a href="([^"]+)"[^>]*class="card productsDetailInner"')
_IMG_RE = re.compile(r'<div class="cardThumb">\s*<img src="([^"]+)"')
_TITLE_RE = re.compile(r'<div class="cardTit">(.*?)</div>', re.S)
_INFO_RE = re.compile(r'<dt class="cardInfoTit">(.*?)</dt>\s*<dd class="cardInfoTxt">(.*?)</dd>', re.S)
_CODE_RE = re.compile(r"\[\s*([A-Z]{2,5}-?\d{2}[A-Z]?)\s*\]")


def _clean(fragment: str | None) -> str | None:
    if fragment is None:
        return None
    s = re.sub(r"<[^>]+>", " ", fragment)
    s = html.unescape(s).replace("​", "").replace("＄", "$")
    s = re.sub(r"\s+", " ", s).strip()
    return None if s in ("", "-") else s


def parse_list_page(page: str) -> list[dict[str, Any]]:
    """Every product block on one list page (booster packs included — filter later)."""
    out: list[dict[str, Any]] = []
    for block in _BLOCK_SPLIT.split(page)[1:]:
        href = _HREF_RE.search(block)
        title = _TITLE_RE.search(block)
        if not href or not title:
            continue
        url = urljoin(f"{SITE}/en/products/", href.group(1))
        slug = url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".html").lower()
        if not PRODUCT_ID_RE.match(slug):
            continue
        tag = (_TAGS_RE.search(block).group(1) if _TAGS_RE.search(block) else "").strip().upper()
        name = _clean(title.group(1)) or slug
        info = {(_clean(k) or ""): _clean(v) for k, v in _INFO_RE.findall(block)}
        code = _CODE_RE.search(name)
        img = _IMG_RE.search(block)
        out.append(
            {
                "id": slug,
                "name": name,
                "code": code.group(1) if code else None,
                "tag": tag or "OTHER",
                "category": TAG_TO_CATEGORY.get(tag, "other"),
                "release_date": info.get("Release Date"),
                "msrp": info.get("MSRP"),
                "url": url,
                "image_src": urljoin(SITE, img.group(1)) if img else None,
                "image": f"{slug}.webp",
            }
        )
    return out


# ---- storage + search ----------------------------------------------------------------

_lock = threading.Lock()
_cache: dict[str, Any] | None = None


def load_catalog(force: bool = False) -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is None or force:
            if CATALOG_PATH.exists():
                _cache = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
            else:
                _cache = {"synced_at": None, "products": []}
        return _cache


def save_catalog(catalog: dict[str, Any]) -> None:
    global _cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CATALOG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(CATALOG_PATH)
    with _lock:
        _cache = catalog


def get_product(product_id: str) -> dict[str, Any] | None:
    return next((p for p in load_catalog()["products"] if p["id"] == product_id), None)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def search_products(q: str = "", category: str | None = None, limit: int = 60) -> list[dict[str, Any]]:
    words = [_norm(w) for w in q.split() if _norm(w)]
    out = []
    for p in load_catalog()["products"]:
        if category and p["category"] != category:
            continue
        hay = _norm(p["name"]) + " " + _norm(p.get("code") or "") + " " + _norm(p["id"])
        if all(w in hay for w in words):
            out.append(p)
    return out[:limit]


# ---- images --------------------------------------------------------------------------


def image_path(product_id: str) -> Path:
    return IMAGE_DIR / f"{product_id}.webp"


def download_image(product: dict[str, Any], session: requests.Session | None = None, force: bool = False) -> bool:
    dest = image_path(product["id"])
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return True
    src = product.get("image_src")
    if not src:
        return False
    # Some thumbnails have Japanese file names — percent-encode the path.
    safe = quote(src, safe=":/?=&%")
    try:
        r = (session or requests).get(safe, headers=HEADERS, timeout=30)
        if r.status_code != 200 or not r.content:
            return False
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(dest)
        return True
    except requests.RequestException as exc:
        logger.warning("product image %s: %s", product["id"], exc)
        return False


# ---- sync ----------------------------------------------------------------------------

Progress = Callable[[str, int, int], None]


def sync_catalog(images: bool = True, progress: Progress | None = None) -> dict[str, Any]:
    report = progress or (lambda stage, done, total: None)
    session = requests.Session()
    session.headers.update(HEADERS)

    products: list[dict[str, Any]] = []
    seen: set[str] = set()
    skipped = 0
    for page_no in range(1, MAX_PAGES + 1):
        page = session.get(LIST_URL.format(page=page_no), timeout=30).text
        found = parse_list_page(page)
        report("pages", page_no, page_no)
        if not found:
            break
        for p in found:
            if p["id"] in seen:
                continue
            seen.add(p["id"])
            if p["tag"] in EXCLUDED_TAGS:
                skipped += 1
                continue
            products.append(p)

    catalog = {
        "source": LIST_URL.format(page=1),
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "excluded": sorted(EXCLUDED_TAGS),
        "count": len(products),
        "products": products,
    }
    save_catalog(catalog)

    if images:
        for i, p in enumerate(products, 1):
            download_image(p, session)
            report("images", i, len(products))

    return {"count": len(products), "skipped": skipped, "synced_at": catalog["synced_at"]}
