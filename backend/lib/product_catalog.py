"""Gundam Card Game product catalog (starter decks, accessories, Premium Bandai, other).

Scraped from https://www.gundam-gcg.com/en/products/list.php?page=N — every product except
BOOSTER PACK — and stored like the card catalog:
  data/products.json        the catalog
  data/product_images/      <product id>.webp (the list thumbnail)

Used by the Add Item search. Refresh with `python scrape_cards.py --products` or the
"Update" link in Add Item (POST /api/products/sync).
"""

from __future__ import annotations

import base64
import math
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

from lib import card_catalog
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

# Premium Bandai accessory sets are often split and sold part by part. The site doesn't list
# the parts, so they're configured here: the Add Item form asks which part is being listed,
# and for "Resources" which resource cards (multi-select) — card numbers from the card database.
PB_PARTS = ["Storage Box", "Sleeves", "Playmat", "Deck Box", "Resources", "Alt-Art Cards", "Divider"]
RESOURCES_PART = "Resources"
PRODUCT_OPTIONS: dict[str, dict[str, Any]] = {
    "pb01": {
        "parts": PB_PARTS,
        "resource_cards": [f"RP-{n:03d}" for n in range(24, 34)],  # RP-024 … RP-033
        # "Alt-Art Cards" choices — PB01's own printings: Heero Yuy, A Show of Resolve
        "alt_art_cards": ["ST02-010_p4", "GD01-100_p4"],
    },
    "pb02": {
        "parts": PB_PARTS,
        "resource_cards": [f"RP-{n:03d}" for n in range(34, 44)],  # RP-034 … RP-043
        # "Alt-Art Cards" choices — PB02's own printings: Awakened Power, Mikazuki Augus
        "alt_art_cards": ["GD02-110_p3", "ST05-010_p4"],
    },
}


def product_options(product_id: str) -> dict[str, Any]:
    """Part choices, resource card numbers and alt-art print ids for a product (empty for most)."""
    opts = PRODUCT_OPTIONS.get(product_id, {})
    return {
        "parts": list(opts.get("parts", [])),
        "resource_cards": list(opts.get("resource_cards", [])),
        "alt_art_cards": list(opts.get("alt_art_cards", [])),
    }


# ---- resource-selection image ---------------------------------------------------------
# A "Resources" listing of several cards (PB01 / PB02) uses one picture of exactly the
# selected cards: an SVG mosaic built from the card images in data/card_images and cached
# in data/product_images (one file per selection).

_RESOURCE_SET_VERSION = "v2"  # bump to rebuild cached mosaics after a layout change


def resource_set_path(product_id: str, codes: list[str]) -> Path:
    key = "_".join(c.replace("-", "").replace("_", "") for c in codes)
    return IMAGE_DIR / f"{product_id}-resources-{_RESOURCE_SET_VERSION}-{key}.svg"


def resource_set_svg(product_id: str, card_images: dict[str, bytes | None]) -> str:
    """Mosaic of the given resource cards (card_no → webp bytes, None = missing) in card ratio."""
    codes = list(card_images)
    n = len(codes)
    cols = max(1, math.ceil(math.sqrt(n)))  # 2 → 2×1, 3–4 → 2×2, 5–9 → 3×3, 10 → 4×3
    rows = -(-n // cols)
    cw, ch, gap, pad = 126, 176, 8, 12  # 63:88 card ratio
    width = pad * 2 + cols * cw + (cols - 1) * gap
    height = pad * 2 + rows * ch + (rows - 1) * gap
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {width} {height}" width="{width}" height="{height}">',
        f"<title>{html.escape(product_id.upper())} resource set</title>",
        f'<rect width="{width}" height="{height}" rx="10" fill="#0B0F17"/>',
    ]
    for i, code in enumerate(codes):
        row, col = divmod(i, cols)
        in_row = min(cols, n - row * cols)  # centre a short last row
        offset = (cols - in_row) * (cw + gap) / 2
        x = pad + offset + col * (cw + gap)
        y = pad + row * (ch + gap)
        data = card_images[code]
        if data:
            href = "data:image/webp;base64," + base64.b64encode(data).decode("ascii")
            parts.append(
                f'<image x="{x:g}" y="{y}" width="{cw}" height="{ch}" preserveAspectRatio="xMidYMid slice" '
                f'href="{href}" xlink:href="{href}"><title>{html.escape(code)}</title></image>'
            )
        else:
            parts.append(
                f'<rect x="{x:g}" y="{y}" width="{cw}" height="{ch}" rx="6" fill="#1E293B"/>'
                f'<text x="{x + cw / 2:g}" y="{y + ch / 2:g}" fill="#94A3B8" font-family="monospace" '
                f'font-size="16" text-anchor="middle">{html.escape(code)}</text>'
            )
    parts.append("</svg>")
    return "".join(parts)


def ensure_resource_set_image(product_id: str, selected: list[str] | None = None) -> Path | None:
    """Build (or reuse) the mosaic of the selected resource cards (all of them when none given).

    Only the product's own resource cards are accepted; None if nothing valid is selected.
    """
    opts = product_options(product_id)
    # a picture of picked cards may use the set's resource cards or its alt-art cards
    allowed = opts["resource_cards"] if selected is None else opts["resource_cards"] + opts["alt_art_cards"]
    codes = [c for c in allowed if selected is None or c in selected]  # keep the set's order
    if not codes:
        return None
    dest = resource_set_path(product_id, codes)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    images: dict[str, bytes | None] = {}
    for code in codes:
        ok = card_catalog.download_image(code)  # local copy, or fetched from the site once
        images[code] = card_catalog.image_path(code).read_bytes() if ok else None
    svg = resource_set_svg(product_id, images)
    if all(images.values()):  # only cache a complete mosaic
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_text(svg, encoding="utf-8")
        return dest
    tmp = IMAGE_DIR / f"{product_id}-resources-partial.svg"  # not cached — retried next time
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    tmp.write_text(svg, encoding="utf-8")
    return tmp


PRODUCT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,40}$")

_BLOCK_SPLIT = re.compile(r'<div class="productsDetail"')
_TAGS_RE = re.compile(r'^\s*data-tags="([^"]*)"')
_HREF_RE = re.compile(r'<a href="([^"]+)"[^>]*class="card productsDetailInner"')
_IMG_RE = re.compile(r'<div class="cardThumb">\s*<img src="([^"]+)"')
_TITLE_RE = re.compile(r'<div class="cardTit">(.*?)</div>', re.S)
_INFO_RE = re.compile(r'<dt class="cardInfoTit">(.*?)</dt>\s*<dd class="cardInfoTxt">(.*?)</dd>', re.S)
_CODE_RE = re.compile(r"\[\s*([A-Z]{2,5}-?\d{2}[A-Z]?)\s*\]")
# "REGULAR VERSION: $11.99 SPECIAL EDITION: $34.99" → two editions (ST01–ST04 today).
_EDITION_RE = re.compile(r"([A-Za-z][A-Za-z ]*?(?:VERSION|EDITION))\s*:\s*([$＄]\s*[\d.,]+)", re.I)


def parse_editions(msrp: str | None) -> list[dict[str, str]]:
    """Editions a product is sold in, read from its MSRP text. Empty when there's only one."""
    if not msrp:
        return []
    found = [
        {"name": name.strip().title(), "msrp": price.replace("＄", "$").replace(" ", "")}
        for name, price in _EDITION_RE.findall(msrp)
    ]
    return found if len(found) > 1 else []


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
                "editions": parse_editions(info.get("MSRP")),
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
