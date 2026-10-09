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
import hashlib
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
from models.item import PART_PHOTO_VERSION, PRODUCT_CATEGORY_OVERRIDES, code_first

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
PB_PARTS = ["Storage Box", "Sleeves", "Playmat", "Deck Box", "Separator", "Resources", "Alt-Art Cards"]
# "Sealed": the whole set, unopened — listed on its own (it can't be combined with the parts).
SEALED_PART = "Sealed"
BRICK_PART = "Brick"
PC01A_KITS = ["ASSEMBLE: Gundam Barbatos 4th Form", "ASSEMBLE: Graze Custom", "ASSEMBLE: CGS Mobile Worker"]
# ST04A (SEED Strike, Special Edition): its three GUNDAM ASSEMBLE mini kits
# ST01A–ST03A (Special Editions): their GUNDAM ASSEMBLE mini kits, each with its photo
# ST02A: Leo (A) standing with its rifle, Leo (B) kneeling with the big gun, Tallgeese with lance and shield
# ST03A: Char's Zaku II (commander horn, machine gun), Zaku II (A) with bazooka, Zaku II (B) with heat hawk
ST01A_KITS = ["ASSEMBLE: Gundam", "ASSEMBLE: Guncannon", "ASSEMBLE: Guntank"]
ST02A_KITS = ["ASSEMBLE: Leo (A)", "ASSEMBLE: Leo (B)", "ASSEMBLE: Tallgeese"]
ST03A_KITS = ["ASSEMBLE: Char's Zaku II", "ASSEMBLE: Zaku II (A)", "ASSEMBLE: Zaku II (B)"]
ST04A_KITS = ["ASSEMBLE: Launcher Strike Gundam", "ASSEMBLE: Sword Strike Gundam", "ASSEMBLE: Skygrasper"]
PC02A_KITS = ["ASSEMBLE: GQuuuuuuX (Omega Psycommu)", "ASSEMBLE: Red Gundam", "ASSEMBLE: GFreD"]
RESOURCES_PART = "Resources"
PRODUCT_OPTIONS: dict[str, dict[str, Any]] = {
    # ST04: the Special Edition can be listed sealed or kit by kit (Add Item shows these parts only
    # for that edition)
    "st01": {"parts": [SEALED_PART, *ST01A_KITS]},
    "st02": {"parts": [SEALED_PART, *ST02A_KITS]},
    "st03": {"parts": [SEALED_PART, *ST03A_KITS]},
    "st04": {"parts": [SEALED_PART, *ST04A_KITS]},
    # the other starter decks (one edition): sealed, or a brick (a case of sealed decks).
    # ST01–ST04's Regular Version offers the same two (set in Add Item).
    **{f"st{n:02d}": {"parts": [SEALED_PART, BRICK_PART]} for n in range(5, 15)},
    # SC01 Deck Build Box: also sold by the brick (a case of sealed boxes)
    "deck-build-box": {"parts": [SEALED_PART, BRICK_PART]},
    "pb01": {
        "parts": [SEALED_PART, *PB_PARTS],
        "resource_cards": [f"RP-{n:03d}" for n in range(24, 34)],  # RP-024 … RP-033
        # "Alt-Art Cards" choices — PB01's own printings: Heero Yuy, A Show of Resolve
        "alt_art_cards": ["ST02-010_p4", "GD01-100_p4"],
    },
    "pb02": {
        "parts": [SEALED_PART, *PB_PARTS],
        "resource_cards": [f"RP-{n:03d}" for n in range(34, 44)],  # RP-034 … RP-043
        # "Alt-Art Cards" choices — PB02's own printings: Awakened Power, Mikazuki Augus
        "alt_art_cards": ["GD02-110_p3", "ST05-010_p4"],
    },
    # GUNDAM CARD GAME 1st Anniversary Set: two sleeve designs (picked under "Sleeves", like the
    # resource cards — SLEEVE_DESIGNS["pb03"]), a leather card case and dice instead of a single
    # sleeve design, deck box and separator.
    "pb03": {
        "parts": [
            SEALED_PART, "Storage Box", "Sleeves", "Playmat", "Card Case",
            "Damage Counter Dice", "Resources", "Alt-Art Cards", "EX Tokens",
        ],
        "resource_cards": ["RP-068", "RP-068_p1"],  # standard / special finish
        # its 10 special printings, plus the set's EX Resource and EX Base (picked under "EX Tokens"
        # in Add Item: the EX… ids)
        "alt_art_cards": [
            "ST03-001_p3", "ST03-008_p5", "ST03-013_p6", "ST07-001_p2", "ST09-008_p2",
            "ST09-009_p2", "GD01-001_p3", "GD01-024_p3", "GD01-118_p8", "GD04-003_p2",
            "EXRP-017", "EXBP-035",
        ],
    },
    # Premium Card Collection GUNDAM ASSEMBLE Sets: three mini kits, alt-art cards and the ASSEMBLE
    # token cards, and a bonus pack with one of five EX Resources ("Resources").
    "pc01a": {
        "parts": [*PC01A_KITS, "Alt-Art Cards", "Resources"],
        "resource_cards": ["EXRP-004", "EXRP-005", "EXRP-006", "EXRP-007", "EXRP-008"],
        "alt_art_cards": [
            "ST05-001_p2", "ST05-007_p2", "GD03-060_p1", "GD03-117_p1", "T-017_p1", "T-016_p1", "T-015_p1",
        ],
    },
    "pc02a": {
        "parts": [*PC02A_KITS, "Alt-Art Cards", "Resources"],
        "resource_cards": ["EXRP-009", "EXRP-010", "EXRP-011", "EXRP-012", "EXRP-013"],
        "alt_art_cards": [
            "ST06-001_p2", "ST06-005_p2", "GD03-048_p1", "GD03-106_p1", "T-019_p1", "T-018_p1", "T-020_p1",
        ],
    },
    # GUNDAM CARD GAME Edition Beta: its box, booster packs and dice, and every Edition Beta printing
    "limitedbox-beta": {
        "parts": ["Storage Box", "Booster Pack", "Damage Counter Dice", "Resources", "Alt-Art Cards"],
        "resource_cards": ["R-001_p4", "R-001_p5", "EXR-001_p5"],
        # only its alternate-art (parallel, "+") printings; the plain Edition Beta reprints aren't alt-art
        "alt_art_cards": [
            "ST01-001_p3", "ST01-011_p3", "ST02-001_p3", "ST03-011_p3", "ST04-001_p3",
            "GD01-004_p2", "GD01-026_p2", "GD01-070_p2", "GD01-088_p2", "GD01-100_p3",
            "GD01-107_p2", "GD01-118_p3",
        ],
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


# ---- part photos ------------------------------------------------------------------------
# Photos for the physical parts of PB01 / PB02, from the official product pages
# (/en/products/pb01.html, pb02.html). The site has one overview photo per set showing the
# sleeves, divider, deck box and storage box together (700×700), so each of those is a crop
# of it — (left, top, right, bottom) as fractions — and the playmat has its own photo.
_PB01_OVERVIEW = f"{SITE}/gcg/bccard/en/news/2025/08/29/iUASpNHVGuqw8AVT/thumbnail_en_02.webp"
_PB01_PLAYMAT = f"{SITE}/gcg/bccard/en/news/2025/08/29/7Oc2IJECClVxr3IN/thumbnail_en_05.webp"
_PB02_OVERVIEW = f"{SITE}/gcg/bccard/en/news/2025/10/07/3Cb0wawqvMs1VYOL/thumbnail_en_01.webp"
_PB02_PLAYMAT = f"{SITE}/gcg/bccard/en/news/2025/10/07/5ex5imft0fVX1b0S/thumbnail_en_02.webp"
# Premium Bandai's own photo of the PB02 storage box on its own (the official overview shot
# only shows it partly, behind the other parts). ?w=700&h=700 → a 700×700 JPEG.
_PB02_STORAGE_BOX = "https://p-bandai.com/files/seller-products/NSP0373930001/GotjJ8yAfMW6lHaPY7bw.jpg?w=700&h=700"
# Premium Bandai's photo of the PB02 deck box (with the divider beside it) on a white background.
_PB02_DECK_BOX = "https://p-bandai.com/files/seller-products/NSP0373930001/3nxITaGEcwjX8v8PWQgO.jpg?w=700&h=700"
# Premium Bandai's photo of the PB01 deck box on its own on a white background.
_PB01_DECK_BOX = "https://p-bandai.com/files/seller-products/NSP0373929001/oIk3U4LOY9U0Fq5N6xKx.jpg?w=700&h=700"
# Premium Bandai's photo of the PB01 storage box on its own, with a caption printed under it.
_PB01_STORAGE_BOX = "https://p-bandai.com/files/seller-products/NSP0373929001/YBneq0ya7El5Tt6RHh7H.jpg?w=700&h=700"
# PB03: one photo of the sleeves, card case, dice and storage box; the playmat on its own.
_PB03_ITEMS = f"{SITE}/gcg/bccard/en/news/2026/07/23/RffcCgFyUvatJiym/thumbnail_en_03.webp"
_PB03_PLAYMAT = f"{SITE}/gcg/bccard/en/news/2026/07/23/XPGR6sOaIhhFhyvQ/thumbnail_en_04.webp"
# GUNDAM ASSEMBLE kit photos (each kit on its own, on black)
_ASSEMBLE = f"{SITE}/gcg/bccard/en/news"
_EDITION_BETA_PB = "https://p-bandai.com/files/seller-products/NSP0341576002"  # Premium Bandai USA listing

Box = tuple[float, float, float, float]  # (left, top, right, bottom) as fractions of the photo


def outside(box: Box) -> list[Box]:
    """The four strips around `box` — as "cover" boxes they paint everything except `box` white."""
    left, top, right, bottom = box
    return [(0.0, 0.0, 1.0, top), (0.0, bottom, 1.0, 1.0), (0.0, top, left, bottom), (right, top, 1.0, bottom)]


# part → (photo, crop, extras). extras (optional):
#   "pad":   white space added around the crop, as a fraction of the crop's size ("zoom out")
#   "cover": boxes painted white, e.g. to hide a caption printed on the photo, or
#            outside(item) to turn the whole backdrop around the item white
#   "whiten": brightness factor (e.g. 1.07) that turns a near-white backdrop pure white
PART_PHOTOS: dict[str, dict[str, tuple]] = {
    "pb01": {
        # whole photo; the caption printed under the box is painted over in white (like PB02)
        "Storage Box": (_PB01_STORAGE_BOX, None, {"cover": [(0.0, 0.88, 1.0, 1.0)]}),
        # sleeves / playmat: same framing as before, with the grey backdrop around them painted white
        "Sleeves": (_PB01_OVERVIEW, (0.06, 0.15, 0.35, 0.55), {"cover": outside((0.073, 0.169, 0.329, 0.52))}),
        "Playmat": (_PB01_PLAYMAT, None, {"cover": outside((0.076, 0.259, 0.924, 0.743)), "whiten": 1.02}),
        # just the deck box from its own white-background photo, zoomed out on white (like PB02)
        "Deck Box": (_PB01_DECK_BOX, (0.22, 0.18, 0.78, 0.89), {"pad": 0.3, "whiten": 1.04}),
        # tight crop of just the divider, zoomed out on white
        "Separator": (_PB01_OVERVIEW, (0.365, 0.152, 0.613, 0.513), {"pad": 0.3}),
    },
    "pb02": {
        # whole photo; the caption printed under the box is painted over in white
        "Storage Box": (_PB02_STORAGE_BOX, None, {"cover": [(0.0, 0.86, 1.0, 1.0)]}),
        "Sleeves": (_PB02_OVERVIEW, (0.04, 0.21, 0.40, 0.49), {"cover": outside((0.053, 0.227, 0.389, 0.471))}),
        "Playmat": (_PB02_PLAYMAT, None, {"cover": outside((0.079, 0.259, 0.923, 0.741)), "whiten": 1.02}),
        # just the deck box from the white-background photo, zoomed out with white space around it
        "Deck Box": (_PB02_DECK_BOX, (0.02, 0.10, 0.575, 0.89), {"pad": 0.3}),
        # tight crop of just the divider (leaves the photo's grey backdrop out), zoomed out on white
        "Separator": (_PB02_OVERVIEW, (0.42, 0.13, 0.655, 0.478), {"pad": 0.3}),
    },
    "pb03": {
        # each piece cropped from the photo and zoomed out on white; "whiten" lifts the pale
        # backdrop left around boxes / dice to white (not used on the sleeves, to keep their colour)
        "Storage Box": (_PB03_ITEMS, (0.07, 0.6357, 0.9329, 0.9529), {"pad": 0.08, "whiten": 1.03}),
        "Sleeves (Blue)": (_PB03_ITEMS, (0.0457, 0.1543, 0.3043, 0.5157), {"pad": 0.1}),
        "Sleeves (Green)": (_PB03_ITEMS, (0.3243, 0.1529, 0.5843, 0.5143), {"pad": 0.1}),
        "Playmat": (_PB03_PLAYMAT, (0.0714, 0.2557, 0.9314, 0.7486), {"pad": 0.05, "whiten": 1.03}),
        "Card Case": (_PB03_ITEMS, (0.6514, 0.0471, 0.9486, 0.4057), {"pad": 0.15, "whiten": 1.03}),
        "Damage Counter Dice": (_PB03_ITEMS, (0.6029, 0.4457, 0.9729, 0.6543), {"pad": 0.1, "whiten": 1.03}),
    },
    # ASSEMBLE kits: the whole kit photo
    # ST04A kits: background-removed photos kept as local files (source-local_st04_….webp),
    # cropped tight so they fill a bundle's mosaic cells
    # ST01A kits: transparent photos (source-local_st01_….webp), cropped tight
    "st01": {
        ST01A_KITS[0]: ("local/st01_gundam.webp", (0.268, 0.24, 0.732, 0.683)),
        ST01A_KITS[1]: ("local/st01_guncannon.webp", (0.24, 0.332, 0.758, 0.668)),
        ST01A_KITS[2]: ("local/st01_guntank.webp", (0.35, 0.24, 0.65, 0.713)),
    },
    # ST02A kits: transparent photos (source-local_st02_….webp), cropped tight
    "st02": {
        ST02A_KITS[0]: ("local/st02_leo_a.webp", (0.295, 0.24, 0.603, 0.677)),
        ST02A_KITS[1]: ("local/st02_leo_b.webp", (0.302, 0.24, 0.697, 0.655)),
        ST02A_KITS[2]: ("local/st02_tallgeese.webp", (0.24, 0.28, 0.76, 0.645)),
    },
    # ST03A kits: transparent photos (source-local_st03_….webp), cropped tight
    "st03": {
        ST03A_KITS[0]: ("local/st03_chars_zaku_ii.webp", (0.37, 0.24, 0.605, 0.705)),
        ST03A_KITS[1]: ("local/st03_zaku_ii_a.webp", (0.24, 0.30, 0.665, 0.655)),
        ST03A_KITS[2]: ("local/st03_zaku_ii_b.webp", (0.38, 0.24, 0.65, 0.70)),
    },
    "st04": {
        ST04A_KITS[0]: ("local/st04_launcher_strike_gundam.webp", (0.13, 0.13, 0.86, 0.79)),
        ST04A_KITS[1]: ("local/st04_sword_strike_gundam.webp", (0.24, 0.25, 0.76, 0.68)),
        ST04A_KITS[2]: ("local/st04_skygrasper.webp", (0.24, 0.24, 0.76, 0.57)),
    },
    # PC01A kits: transparent photos (source-local_pc01a_….webp), cropped tight
    "pc01a": {
        PC01A_KITS[0]: ("local/pc01a_barbatos_4th_form.webp", (0.26, 0.24, 0.738, 0.76)),
        PC01A_KITS[1]: ("local/pc01a_graze_custom.webp", (0.273, 0.24, 0.727, 0.705)),
        PC01A_KITS[2]: ("local/pc01a_cgs_mobile_worker.webp", (0.24, 0.322, 0.758, 0.64)),
    },
    # PC02A kits: transparent photos (source-local_pc02a_….webp), cropped tight
    "pc02a": {
        PC02A_KITS[0]: ("local/pc02a_gquuuuuux.webp", (0.357, 0.24, 0.628, 0.697)),
        PC02A_KITS[1]: ("local/pc02a_red_gundam.webp", (0.335, 0.265, 0.77, 0.633)),  # saber tip trimmed so it matches the others in size
        PC02A_KITS[2]: ("local/pc02a_gfred.webp", (0.27, 0.24, 0.688, 0.673)),
    },
    # Edition Beta: Premium Bandai's photos on white — the box and the dice on their own, and the
    # booster pack cropped from the photo of it beside sample cards; zoomed out a little on white
    "limitedbox-beta": {
        "Storage Box": (f"{_EDITION_BETA_PB}/WkSQ3E5RiNHuMSmFWVyy.jpg?w=700&h=700", (0.1429, 0.0643, 0.9414, 0.8914), {"pad": 0.06}),
        "Booster Pack": (f"{_EDITION_BETA_PB}/I7yETHyxuAruebtXdz7m.jpg?w=700&h=700", (0.0471, 0.1571, 0.4371, 0.8443), {"pad": 0.08}),
        "Damage Counter Dice": (f"{_EDITION_BETA_PB}/SzwwePOsimjb0N7FMktl.jpg?w=700&h=700", (0.1186, 0.24, 0.8814, 0.7471), {"pad": 0.08}),
    },
}


def part_slug(part: str) -> str:
    """"Storage Box" → "storage-box" (used in the photo's file name / URL)."""
    return re.sub(r"[^a-z0-9]+", "-", part.lower()).strip("-")


def part_photo_urls(product_id: str) -> dict[str, str]:
    """Part → photo URL served by the app, e.g. {"Playmat": "/api/product-images/pb01-part-playmat.svg"}."""
    return {
        part: f"/api/product-images/{product_id}-part-{part_slug(part)}.svg?v={PART_PHOTO_VERSION}"
        for part in PART_PHOTOS.get(product_id, {})
    }


def part_photo_svg(
    photo: bytes,
    crop: Box | None,
    size: int = 700,
    pad: float = 0.0,
    cover: list[Box] | None = None,
    whiten: float = 1.0,
) -> str:
    """The photo (webp or jpeg bytes, size×size) as an SVG: cropped to `crop` (whole photo if
    None), with `pad` × the crop's size of white space around it, and `cover` boxes painted white."""
    x0, y0, x1, y1 = crop or (0.0, 0.0, 1.0, 1.0)
    cx, cy, cw, ch = x0 * size, y0 * size, (x1 - x0) * size, (y1 - y0) * size
    px, py = cw * pad, ch * pad
    vx, vy, vw, vh = cx - px, cy - py, cw + 2 * px, ch + 2 * py
    mime = "image/jpeg" if photo[:2] == b"\xff\xd8" else "image/webp"
    href = f"data:{mime};base64," + base64.b64encode(photo).decode("ascii")
    covers = "".join(
        f'<rect x="{a * size:g}" y="{b * size:g}" width="{(c - a) * size:g}" height="{(d - b) * size:g}" fill="#FFFFFF"/>'
        for a, b, c, d in (cover or [])
    )
    # brighten every channel (clamped at white), so a pale backdrop becomes pure white
    whiten_filter = (
        f'<filter id="whiten" color-interpolation-filters="sRGB"><feComponentTransfer>'
        f'<feFuncR type="linear" slope="{whiten:g}"/><feFuncG type="linear" slope="{whiten:g}"/>'
        f'<feFuncB type="linear" slope="{whiten:g}"/></feComponentTransfer></filter>'
        if whiten != 1.0
        else ""
    )
    image_filter = ' filter="url(#whiten)"' if whiten != 1.0 else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="{vx:g} {vy:g} {vw:g} {vh:g}" width="{vw:g}" height="{vh:g}">'
        f'<defs><clipPath id="crop"><rect x="{cx:g}" y="{cy:g}" width="{cw:g}" height="{ch:g}"/></clipPath>{whiten_filter}</defs>'
        f'<rect x="{vx:g}" y="{vy:g}" width="{vw:g}" height="{vh:g}" fill="#FFFFFF"/>'
        f'<g clip-path="url(#crop)"><image x="0" y="0" width="{size}" height="{size}" href="{href}" xlink:href="{href}"{image_filter}/></g>'
        f"{covers}</svg>"
    )


def _source_file(src: str) -> Path:
    source_name = re.sub(r"[^A-Za-z0-9._-]+", "_", src.split("://", 1)[-1].split("?", 1)[0])[-80:]
    return IMAGE_DIR / f"source-{source_name}"


def photo_stamp(src: str) -> int:
    """When the stored photo last changed (0 if not downloaded yet). Part in the cache key of every
    picture cut from it, so replacing a photo (e.g. with a background-removed one) rebuilds them."""
    source_file = _source_file(src)
    return int(source_file.stat().st_mtime) if source_file.exists() else 0


def source_photo(src: str) -> bytes | None:
    """An official photo, downloaded once and kept in data/product_images; None if unreachable."""
    source_file = _source_file(src)
    if not (source_file.exists() and source_file.stat().st_size > 0):
        try:
            r = requests.get(src, headers=HEADERS, timeout=30)
        except requests.RequestException as exc:
            logger.warning("photo %s: %s", src, exc)
            return None
        if r.status_code != 200 or not r.content:
            return None
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        source_file.write_bytes(r.content)
    return source_file.read_bytes()


def ensure_part_photo(product_id: str, slug: str) -> Path | None:
    """Download (once) the official photo and build the cropped part picture; None if unknown."""
    parts = {part_slug(p): v for p, v in PART_PHOTOS.get(product_id, {}).items()}
    if slug not in parts:
        return None
    src, crop, *rest = parts[slug]
    extras = rest[0] if rest else {}
    # The cache file name carries a fingerprint of the photo + crop + extras, so changing any
    # of them (a better photo, a wider crop, padding) rebuilds the picture automatically.
    fingerprint = hashlib.sha1(f"{src}|{crop}|{sorted(extras.items())}|{photo_stamp(src)}".encode()).hexdigest()[:8]
    dest = IMAGE_DIR / f"{product_id}-part-{slug}-{fingerprint}.svg"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    photo = source_photo(src)
    if photo is None:
        return None
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        part_photo_svg(
            photo,
            crop,
            pad=extras.get("pad", 0.0),
            cover=extras.get("cover"),
            whiten=extras.get("whiten", 1.0),
        ),
        encoding="utf-8",
    )
    return dest


# ---- resource-selection image ---------------------------------------------------------
# A "Resources" listing of several cards (PB01 / PB02) uses one picture of exactly the
# selected cards: an SVG mosaic built from the card images in data/card_images and cached
# in data/product_images (one file per selection).

_RESOURCE_SET_VERSION = "v3"  # bump to rebuild cached mosaics after a layout change


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


# ---- sleeve designs / set contents ---------------------------------------------------------
# Products whose contents are picked in Add Item (multi-select, copies per pick, like PB02's
# resource cards): the designs of a sleeve pack, or the pieces of a set (storage box, playmat,
# resource cards …). A listing of one pick shows that piece; two or more show a mosaic.
# Each pick is either cropped from an official product-page photo (700×700; (left, top, right,
# bottom) as fractions) or a card from the card database.
_GCG = f"{SITE}/gcg/bccard"
_SLEEVE01_PHOTO = f"{_GCG}/en/news/2025/04/08/9MUseK8Aaletg48h/thumbnail_jp.webp"
_SLEEVE02_PHOTO = f"{_GCG}/jp/news/2025/08/27/hiHD6DwZTicwA06W/products_thumbnail.webp"
_SLEEVE03_PHOTO = f"{_GCG}/en/news/2026/03/25/SQxXZhkpL7eWm3ig/products_thumbnail_en.webp"
_EV03_PHOTO = f"{_GCG}/en/news/2025/06/17/yANgXUSJVRHEao7s/products_thumbnail.webp"
_EVX06_PHOTO = f"{_GCG}/jp/news/2026/03/17/OEnY3l8RgEwM3KGC/%E5%95%86%E5%93%811.webp"  # 商品1.webp
_EVX12_PHOTO = f"{_GCG}/jp/news/2026/08/03/IwUgBnMyyFyRbtzx/products_thumbnail.webp"
_GOODSSET01_PLAYMAT = f"{_GCG}/en/news/2025/06/18/CxrDV0bFDAmgciH4/thumbnail_playmat.webp"
_GOODSSET01_BOX = f"{_GCG}/en/news/2025/06/18/S2zosRbEbqmp1rkQ/thumbnail_storage.webp"
_EVX07_BOX = f"{_GCG}/jp/news/2026/03/17/aBmwXh65tZru7pW7/%E5%95%86%E5%93%811.webp"  # 商品1.webp
# 商品詳細_アイテム.webp / 商品詳細_カード画像.webp — transparent backgrounds
_EVX09_DECK_BOX = f"{_GCG}/jp/news/2026/09/08/XcSpJUrrbEwBlJzn/%E5%95%86%E5%93%81%E8%A9%B3%E7%B4%B0_%E3%82%A2%E3%82%A4%E3%83%86%E3%83%A0.webp"
_EVX09_EX_BASE = f"{_GCG}/en/news/2026/09/10/15kKcfA6yiwr3Sf0/%E5%95%86%E5%93%81%E8%A9%B3%E7%B4%B0_%E3%82%AB%E3%83%BC%E3%83%89%E7%94%BB%E5%83%8F.webp"
_SC01_BOXES = f"{_GCG}/en/news/2026/06/24/FvcWT4Sa65PTosqu/thumbnail_box-card_frame.webp"  # the 3 box designs
_DECK_CASE01 = f"{_GCG}/en/news/2025/04/08/6QfDGplYPVqVbP36/thumbnail_en.webp"
_DECK_CASE02 = f"{_GCG}/en/news/2026/03/25/fZumAcw3xApR9KbI/products_thumbnail_en.webp"
_PLAYMAT01 = f"{_GCG}/en/news/2026/03/25/FexyOy90fSiGykB7/products_thumbnail_en.webp"
_EVX11 = f"{_GCG}/en/news/2026/08/03/J3RR1KJyn7uSQXJY/products_thumbnail_en.webp"
_DICE01 = f"{_GCG}/en/news/2025/04/08/2LYV6alslbLD5hXa/thumbnail_jp.webp"
# no official photo online for this one: a background-removed photo kept in data/product_images
# (source-local_ev02_playmat_card.webp), never downloaded
_EV02 = "local/ev02_playmat_card.webp"
# background-removed photos (same kind of local file): SC01's three boxes, EVX07's box
_SC01_BOXES_CLEAN = "local/sc01_boxes.webp"
_EVX07_BOX_CLEAN = "local/evx07_box.webp"
_SC01_BONUS_PACK = "local/sc01_bonus_pack.webp"


def _photo(name: str, photo: str, box: Box, fill: bool = False) -> dict[str, Any]:
    """A piece cropped from a photo. fill=True for card-shaped pieces (sleeves, cards), which
    fill their mosaic cell; the rest (boxes, playmats, dice, separators) are fitted inside it."""
    return {"name": name, "photo": photo, "box": box, "fill": fill}


def _px(left: int, top: int, right: int, bottom: int) -> Box:
    """A crop measured in pixels of a 700×700 photo."""
    return (left / 700, top / 700, right / 700, bottom / 700)


def _cards(*card_ids: str) -> dict[str, dict[str, Any]]:
    """Card picks, keyed by lowercase id ("rp-011"), named by card number ("RP-011")."""
    return {c.lower(): {"name": c.split("_")[0], "card": c} for c in card_ids}


def _sleeves(photo: str, *designs: tuple[str, str, Box]) -> dict[str, dict[str, Any]]:
    return {pick_id: _photo(name, photo, box, fill=True) for pick_id, name, box in designs}


# Sleeve crops are measured per sleeve and sit 1 px inside its edge, so no background shows.
SLEEVES_LABEL, CONTENTS_LABEL = "Sleeve designs", "Set contents"
EXTRAS_LABEL = "Extras"  # optional picks: the product can also be listed without any
# product id → (picker label, pick id → {"name", and "photo" + "box", or "card"})
SLEEVE_DESIGNS: dict[str, tuple[str, dict[str, dict[str, Any]]]] = {
    "sleeve01": (SLEEVES_LABEL, _sleeves(
        _SLEEVE01_PHOTO,
        ("logo", "GUNDAM CARD GAME Logo", (0.196, 0.09, 0.483, 0.484)),
        ("affection", "Overflowing Affection", (0.517, 0.09, 0.804, 0.484)),
        ("efsf", "Gundam/EFSF", (0.196, 0.516, 0.483, 0.91)),
        ("zaku", "Char's Zaku Ⅱ/Zeon", (0.517, 0.516, 0.804, 0.91)),
    )),
    # Official Card Sleeves 02 — names from the Japanese product page (the English one has none)
    # each design from its own sharp photo: shown as-is (frontend/public/cutouts/sleeve03-….webp) and
    # cut from a square copy (source-local_sleeve03_….webp) for multi-design pictures
    "sleeve03": (SLEEVES_LABEL, {
        pick_id: {
            **_photo(name, f"local/sleeve03_{pick_id}.webp", (0.1362, 0.0, 0.8638, 1.0), fill=True),
            "image": f"/cutouts/sleeve03-{pick_id}.webp",
        }
        for pick_id, name in (
            ("suletta", "Suletta Mercury"),
            ("goddess", "Goddess of Fortune"),
            ("shining", "Shining Gundam VS Master Gundam"),
            ("nu", "ν Gundam VS Sazabi"),
        )
    }),
    # PB03's two sleeve designs, shown when its "Sleeves" part is picked. Ids match the part photo
    # slugs (so a bundle picture can show them); each is shown (and listed) as its flat sleeve art,
    # a static file in frontend/public/cutouts/.
    "pb03": (SLEEVES_LABEL, {
        f"sleeves-{c.lower()}": {**_photo(f"Sleeves ({c})", "local/pb03_sleeves.webp", box, fill=True), "image": f"/cutouts/pb03-sleeve-{c.lower()}.webp"}
        # crops of the background-removed sleeve photo (source-local_pb03_sleeves.webp, 1200×1200)
        for c, box in (("Blue", (0.0525, 0.2092, 0.4758, 0.7917)), ("Green", (0.525, 0.2092, 0.9483, 0.7908)))
    }),
    "sleeve02": (SLEEVES_LABEL, _sleeves(  # Official Matte Sleeves EX
        _SLEEVE02_PHOTO,
        ("char", "Char", (0.1957, 0.0914, 0.48, 0.4829)),
        ("vist", "Vist Foundation", (0.5186, 0.0914, 0.8043, 0.4843)),
        ("tekkadan", "Tekkadan", (0.1943, 0.5171, 0.4814, 0.9086)),
        ("pomeranians", "Pomeranians", (0.52, 0.5171, 0.8043, 0.9086)),
    )),
    "ev03": (SLEEVES_LABEL, _sleeves(  # [EVX03] Official Card Sleeves EX
        _EV03_PHOTO,
        ("space-black", "Space Black", (0.1243, 0.2571, 0.4771, 0.7443)),
        ("haro", "Haro", (0.5214, 0.2557, 0.8771, 0.7443)),
    )),
    "evx06": (SLEEVES_LABEL, _sleeves(  # [EVX06] Official Matte Sleeves EX02 (site order ≠ photo order)
        _EVX06_PHOTO,
        ("zeon", "Zeon", (0.5171, 0.52, 0.8, 0.91)),
        ("zaft", "ZAFT", (0.5171, 0.0914, 0.8, 0.48)),
        ("celestial-being", "Celestial Being", (0.1943, 0.52, 0.4786, 0.91)),
        ("mafty", "Mafty", (0.1943, 0.0914, 0.4771, 0.48)),
    )),
    "evx12": (SLEEVES_LABEL, _sleeves(  # [EVX12] Official Card Sleeves EX 03
        _EVX12_PHOTO,
        ("nu-gundam", "Nu Gundam", (0.1243, 0.2571, 0.4786, 0.7443)),
        ("zaku", "ZakuⅡ", (0.5229, 0.2571, 0.8771, 0.7457)),
    )),
    "goodsset01": (CONTENTS_LABEL, {  # [EVX-01] Accessory and Card Set 01 FIRST COMBAT
        "storage-box": _photo("Storage Box", _GOODSSET01_BOX, (0.066, 0.289, 0.937, 0.714)),
        "playmat": _photo("Playmat", _GOODSSET01_PLAYMAT, (0.069, 0.254, 0.934, 0.749)),
        **_cards(*(f"RP-{n:03d}" for n in range(11, 21))),  # RP-011 … RP-020
    }),
    "evx07": (CONTENTS_LABEL, {  # [EVX07] Storage Box & Resource Card Set
        "storage-box": _photo("Storage Box", _EVX07_BOX_CLEAN, (0.2571, 0.0386, 0.75, 0.43)),
        **_cards(*(f"RP-{n:03d}" for n in range(45, 55))),  # RP-045 … RP-054
    }),
    "evx09": (CONTENTS_LABEL, {  # [EVX09] Special Booster Bundle 01 (its EX Base isn't in the card list)
        "deck-box": _photo("Deck Box", _EVX09_DECK_BOX, (0.274, 0.146, 0.729, 0.867)),
        "ex-base": _photo("EX Base", _EVX09_EX_BASE, (0.261, 0.167, 0.737, 0.831), fill=True),
    }),
    "deck-build-box": (CONTENTS_LABEL, {  # [SC01] Deck Build Box Freedom Ascension
        "storage-box-1": _photo("Storage Box (Design 1)", _SC01_BOXES_CLEAN, (0.02, 0.1171, 0.4914, 0.4929)),
        "storage-box-2": _photo("Storage Box (Design 2)", _SC01_BOXES_CLEAN, (0.5086, 0.1171, 0.98, 0.4929)),
        "storage-box-3": _photo("Storage Box (Design 3)", _SC01_BOXES_CLEAN, (0.2571, 0.5257, 0.7286, 0.9014)),
        "bonus-pack": _photo("Bonus Pack", _SC01_BONUS_PACK, (0.2257, 0.0143, 0.7743, 0.9857)),
        **_cards("EXBP-025", "EXBP-026", "EXBP-027", "EXB-001_p7", "EXR-001_p7"),  # bonus EX Bases, tokens
    }),
    "deck-case01": (CONTENTS_LABEL, {  # Official Card Case Set 01
        "deck-case": _photo("Deck Case", _DECK_CASE01, _px(136, 68, 337, 350)),
        "separator": _photo("Separator", _DECK_CASE01, _px(366, 61, 561, 339)),
        **_cards("EXRP-002", "EXBP-002"),  # EX Resource (Lacus Clyne), EX Base (Strike Gundam)
    }),
    "deck-case02": (CONTENTS_LABEL, {  # Official Card Case Set 02
        "deck-case": _photo("Deck Case", _DECK_CASE02, _px(131, 60, 340, 352)),
        "separator": _photo("Separator", _DECK_CASE02, _px(365, 61, 562, 342)),
        **_cards("GD01-023_p2", "GD01-030_p3"),  # Char's Gelgoog, Rick Dom (promo printings)
    }),
    "playmat01": (CONTENTS_LABEL, {  # Official Playmat & Card Set — Mobile Suit Gundam 00 —
        "playmat": _photo("Playmat", _PLAYMAT01, _px(90, 57, 610, 360)),
        **_cards("EXRP-015"),
    }),
    "ev02": (CONTENTS_LABEL, {  # [EVX02] Official Playmat and Card Set Suletta & Miorine
        "playmat": _photo("Playmat", _EV02, _px(95, 61, 605, 354)),
        **_cards("EXRP-003"),  # EX Resource (Suletta & Miorine)
    }),
    # Starter decks: their bonus pack (background-removed photos kept as local files). Optional —
    # with nothing picked the listing is the deck itself.
    **{
        deck: (EXTRAS_LABEL, {"bonus-pack": _photo("Bonus Pack", f"local/{deck}_bonus_pack.webp", (0.2571, 0.0729, 0.7457, 0.9371))})
        for deck in ("st01", "st02", "st03", "st04", "st05", "st06", "st07", "st08", "st09", "st10", "st11", "st12", "st13", "st14")
    },
    # Premium Card Collection GUNDAM ASSEMBLE Sets: their bonus pack (one of five EX Resources)
    "pc01a": (EXTRAS_LABEL, {"bonus-pack": _photo("Bonus Pack", "local/pc01_bonus_pack.webp", (0.2571, 0.0729, 0.7457, 0.9371))}),
    "pc02a": (EXTRAS_LABEL, {"bonus-pack": _photo("Bonus Pack", "local/pc02_bonus_pack.webp", (0.2571, 0.0729, 0.7457, 0.9371))}),
    "evx11": (CONTENTS_LABEL, {  # [EVX11] Official Playmat and Card Set Athrun & Cagalli
        "playmat": _photo("Playmat", _EVX11, _px(89, 56, 610, 359)),
        **_cards("EXRP-019"),  # EX Resource (Athrun & Cagalli)
    }),
    # Premium Card Collections: six cards each
    "evx05": (CONTENTS_LABEL, _cards("ST01-001_p4", "ST03-008_p4", "ST05-002_p3", "ST06-002_p3", "GD01-068_p2", "GD01-086_p2")),
    "evx13": (CONTENTS_LABEL, _cards("ST03-006_p3", "GD01-073_p1", "GD03-101_p2", "GD04-063_p1", "GD05-110_p1", "GD05-114_p2")),
    "dice01": (CONTENTS_LABEL, {  # Official Damage Counter Dice 01: 6 dice with a case
        "dice": _photo("Dice (x6)", _DICE01, _px(79, 267, 332, 540)),
        "case": _photo("Dice Case", _DICE01, _px(363, 159, 623, 540)),
    }),
}

# ST09 also comes with damage counter dice (a transparent photo kept as a local file,
# source-local_st09_damage_counter.webp, 700×700). The whole photo is used: the dice sit in it at the
# same scale as EVX08's, so the tiles of all damage counters look the same size.
SLEEVE_DESIGNS["st09"][1]["damage-counter"] = _photo(
    "Damage Counter Dice", "local/st09_damage_counter.webp", (0.0, 0.0, 1.0, 1.0)
)

# Sleeve designs cut from a shared photo are small (about 200 px wide), so each also has an enlarged,
# sharpened copy (frontend/public/cutouts/<product>-<design>.webp) shown on its tile and in the hover
# preview at the same size as a card. Multi-design pictures are still cut from the photo.
for _pid in ("sleeve01", "sleeve02", "ev03", "evx06", "evx12"):
    for _pick_id, _pick in SLEEVE_DESIGNS[_pid][1].items():
        _pick.setdefault("image", f"/cutouts/{_pid}-{_pick_id}.webp")


def _card_shaped(pick: dict[str, Any]) -> bool:
    """Cards and sleeves fill a mosaic cell; boxes, playmats, dice and separators are fitted inside it."""
    return "card" in pick or pick.get("fill", False)


def sleeve_label(product_id: str) -> str | None:
    return SLEEVE_DESIGNS[product_id][0] if product_id in SLEEVE_DESIGNS else None


def sleeve_designs(product_id: str) -> list[dict[str, str]]:
    """The product's picks: id, name, a picture of just that piece, and how to fit it in a tile."""
    _, picks = SLEEVE_DESIGNS.get(product_id, ("", {}))
    return [
        {
            "id": pick_id,
            "name": pick["name"],
            "image_url": f"/api/card-images/{pick['card']}.webp"
            if "card" in pick
            else pick["image"]
            if "image" in pick
            else f"/api/product-images/{product_id}-sleeves.svg?designs={pick_id}",
            "fit": "cover" if _card_shaped(pick) else "contain",
        }
        for pick_id, pick in picks.items()
    ]


def _data_uri(data: bytes) -> str:
    mime = "image/jpeg" if data[:2] == b"\xff\xd8" else "image/png" if data[:4] == b"\x89PNG" else "image/webp"
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def sleeve_set_svg(cells: list[tuple[bytes, Box | None, bool]], size: int = 700) -> str:
    """One piece, or a mosaic of several laid out like the resource card mosaic (2 → 2×1,
    3–4 → 2×2 …, dark background, short last row centred).

    cells: (image bytes, crop box in a size×size photo — None for a whole card image, fills cell).
    """
    head = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    # each distinct image is embedded once and reused
    ids: dict[bytes, str] = {}
    defs = []
    for data, box, _ in cells:
        if data not in ids:
            ids[data] = f"img{len(ids)}"
            w, h = (size, size) if box is not None else (630, 880)
            defs.append(f'<image id="{ids[data]}" width="{w}" height="{h}" href="{_data_uri(data)}" xlink:href="{_data_uri(data)}"/>')
    defs_xml = f"<defs>{''.join(defs)}</defs>"

    def view(box: Box | None) -> tuple[float, float, float, float]:
        if box is None:
            return 0, 0, 630, 880
        x0, y0, x1, y1 = box
        return x0 * size, y0 * size, (x1 - x0) * size, (y1 - y0) * size

    def use(data: bytes) -> str:
        return f'<use href="#{ids[data]}" xlink:href="#{ids[data]}"/>'

    if len(cells) == 1:  # a single piece: just that piece
        data, box, _ = cells[0]
        vx, vy, vw, vh = view(box)
        return f'{head}viewBox="{vx:g} {vy:g} {vw:g} {vh:g}" width="{vw:g}" height="{vh:g}">{defs_xml}{use(data)}</svg>'
    n = len(cells)
    cols = max(1, math.ceil(math.sqrt(n)))
    rows = -(-n // cols)
    cw, ch, gap, pad = 126, 176, 8, 12  # same cells as the resource card mosaic
    width = pad * 2 + cols * cw + (cols - 1) * gap
    height = pad * 2 + rows * ch + (rows - 1) * gap
    # transparent between the cells, so the mosaic floats on the listing tile's backdrop
    parts = [f'{head}viewBox="0 0 {width} {height}" width="{width}" height="{height}">', defs_xml]
    for i, (data, box, fill) in enumerate(cells):
        row, col = divmod(i, cols)
        in_row = min(cols, n - row * cols)
        x = pad + (cols - in_row) * (cw + gap) / 2 + col * (cw + gap)
        y = pad + row * (ch + gap)
        vx, vy, vw, vh = view(box)
        # clip to the crop: a fitted (meet) piece leaves room in its cell, which would otherwise
        # show the rest of the photo around it
        parts.append(
            f'<svg x="{x:g}" y="{y}" width="{cw}" height="{ch}" viewBox="{vx:g} {vy:g} {vw:g} {vh:g}" '
            f'preserveAspectRatio="xMidYMid {"slice" if fill else "meet"}">'
            f'<clipPath id="cell{i}"><rect x="{vx:g}" y="{vy:g}" width="{vw:g}" height="{vh:g}"/></clipPath>'
            f'<g clip-path="url(#cell{i})">{use(data)}</g></svg>'
        )
    parts.append("</svg>")
    return "".join(parts)


_SLEEVE_SET_VERSION = "3"  # bump to rebuild cached pictures after a layout change


def ensure_sleeve_image(product_id: str, selected: list[str]) -> Path | None:
    """Picture of the selected picks (one piece, or a mosaic); None if none are valid."""
    _, picks = SLEEVE_DESIGNS.get(product_id, ("", {}))
    ids = [p for p in picks if p in selected]  # keep the product's order
    if not ids:
        return None
    chosen = [picks[p] for p in ids]
    stamps = [photo_stamp(p["photo"]) for p in chosen if "photo" in p]
    fingerprint = hashlib.sha1(f"{_SLEEVE_SET_VERSION}|{chosen!r}|{stamps}".encode()).hexdigest()[:8]
    dest = IMAGE_DIR / f"{product_id}-sleeves-{'_'.join(ids)}-{fingerprint}.svg"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    cells: list[tuple[bytes, Box | None, bool]] = []
    for pick in chosen:
        if "card" in pick:
            if not card_catalog.download_image(pick["card"]):
                return None
            cells.append((card_catalog.image_path(pick["card"]).read_bytes(), None, True))
        else:
            photo = source_photo(pick["photo"])
            if photo is None:
                return None
            cells.append((photo, pick["box"], _card_shaped(pick)))
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    dest.write_text(sleeve_set_svg(cells), encoding="utf-8")
    return dest


# ---- bundles (several parts of a set in one listing) --------------------------------------
# PB01 / PB02 / PB03 / PC01A / PC02A / Edition Beta: picking two or more parts in Add Item lists
# them together as one bundle. Its picture is a mosaic (same layout as the resource cards) of each
# picked part's photo followed by each picked card.


def _part_crop(crop: Box | None, extras: dict[str, Any]) -> Box:
    """The part's crop, trimmed to leave out areas its photo paints over in white (a caption strip,
    or the backdrop around the item) — a mosaic cell shows just the part."""
    left, top, right, bottom = crop or (0.0, 0.0, 1.0, 1.0)
    covers = extras.get("cover") or []
    for x0, y0, x1, y1 in covers:  # full-width strips first (top / bottom)
        if x0 <= left and x1 >= right:
            if y0 <= top < y1:
                top = max(top, y1)
            elif y0 < bottom <= y1:
                bottom = min(bottom, y0)
    for x0, y0, x1, y1 in covers:  # then side strips spanning what's left of the height
        if y0 <= top and y1 >= bottom:
            if x0 <= left < x1:
                left = max(left, x1)
            elif x0 < right <= x1:
                right = min(right, x0)
    return (left, top, right, bottom)


_BUNDLE_VERSION = "2"  # bump to rebuild cached bundle pictures after a layout change


def ensure_bundle_image(product_id: str, part_slugs: list[str], cards: list[str]) -> Path | None:
    """Mosaic of the picked parts' photos and the picked cards (the product's own only)."""
    photos = {part_slug(p): v for p, v in PART_PHOTOS.get(product_id, {}).items()}
    part_slugs = ["separator" if s == "divider" else s for s in part_slugs]  # listings saved before the rename
    opts = product_options(product_id)
    slugs = [s for s in photos if s in part_slugs]  # keep the product's order
    codes = [c for c in opts["resource_cards"] + opts["alt_art_cards"] if c in cards]
    if len(slugs) + len(codes) == 0:
        return None
    stamps = [photo_stamp(photos[s][0]) for s in slugs]
    key = hashlib.sha1(f"{_BUNDLE_VERSION}|{slugs}|{codes}|{[photos[s] for s in slugs]!r}|{stamps}".encode()).hexdigest()[:10]
    dest = IMAGE_DIR / f"{product_id}-bundle-{key}.svg"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    cells: list[tuple[bytes, Box | None, bool]] = []
    for slug in slugs:
        src, crop, *rest = photos[slug]
        photo = source_photo(src)
        if photo is None:
            return None
        cells.append((photo, _part_crop(crop, rest[0] if rest else {}), False))
    for code in codes:
        if not card_catalog.download_image(code):
            return None
        cells.append((card_catalog.image_path(code).read_bytes(), None, True))
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    dest.write_text(sleeve_set_svg(cells), encoding="utf-8")
    return dest


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
                "name": code_first(name),  # "[ST14] Heavy Dominion" — code first
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


# Product pairs shown in each other's place in Add Item (the site lists EVX13 last, after Edition Beta).
SWAPPED_PRODUCTS = [("limitedbox-beta", "evx13")]


def _apply_category_overrides(catalog: dict[str, Any]) -> dict[str, Any]:
    products = catalog["products"]
    for p in products:
        p["category"] = PRODUCT_CATEGORY_OVERRIDES.get(p["id"], p["category"])
    ids = [p["id"] for p in products]
    for first, second in SWAPPED_PRODUCTS:
        if first in ids and second in ids:
            i, j = ids.index(first), ids.index(second)
            if i < j:  # not swapped yet (a cached catalog may already be)
                products[i], products[j] = products[j], products[i]
                ids[i], ids[j] = ids[j], ids[i]
    return catalog


def load_catalog(force: bool = False) -> dict[str, Any]:
    global _cache
    with _lock:
        if _cache is None or force:
            if CATALOG_PATH.exists():
                _cache = _apply_category_overrides(json.loads(CATALOG_PATH.read_text(encoding="utf-8")))
            else:
                _cache = {"synced_at": None, "products": []}
        return _cache


def save_catalog(catalog: dict[str, Any]) -> None:
    global _cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _apply_category_overrides(catalog)
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
