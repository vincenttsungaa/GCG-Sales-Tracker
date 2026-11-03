"""Pydantic models for the unified collection inventory (cards + general items)."""

import re
from decimal import ROUND_HALF_UP, Decimal
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

Kind = Literal["card", "item"]
Status = Literal["for_sale", "pending", "on_hold", "sold"]

GundamColor = Literal["red", "white", "blue", "green", "purple"]
CardType = Literal[
    "unit", "pilot", "ex base", "ex resource", "resource", "command", "base", "unit token"
]
# Official site rarities (U, U+, P+, LKC+/LKR+/LKU+) plus the older labels SP and LK.
Rarity = Literal[
    "C", "C+", "C++", "U", "U+", "R", "R+", "LR", "LR+", "LR++",
    "SP", "P", "P+", "LK", "LKC+", "LKR+", "LKU+",
]
# Item categories follow the official product list (booster packs are not tracked as items).
ItemCategory = Literal["starter deck", "accessories", "premium bandai", "other"]

# Products filed under a different category than the product site's tag (product id → category).
# SC01 Deck Build Box is tagged ACCESSORIES on the site, but it's a sealed box like the "other" products.
PRODUCT_CATEGORY_OVERRIDES = {"deck-build-box": "other"}

# Values from older versions — mapped on read so old records still load.
LEGACY_RARITY = {"UC": "U", "UC+": "U+"}
LEGACY_PART = {"Divider": "Separator"}
# Categories from before the product database.
LEGACY_CATEGORY = {
    "playmat": "accessories",
    "sleeves": "accessories",
    "deck box": "accessories",
    "binder": "accessories",
    "booster box": "other",
    "model kit": "other",
}


def utcnow() -> datetime:
    """Aware UTC now — store aware, so Pydantic serialises the offset."""
    return datetime.now(timezone.utc)


class BundleEntry(BaseModel):
    """One product in a bundle listing (e.g. ST09 + ST01 sold together), with its own price."""

    name: str
    product_id: str | None = None
    category: ItemCategory | None = None
    kind: Literal["card", "item"] | None = None  # "card" for a single card in the bundle
    code: str | None = None  # e.g. "ST09"
    image_url: str | None = None
    detail: str | None = None  # what was picked, e.g. "Storage Box · RP-034 (1x)"
    quantity: int = Field(default=1, ge=1)
    price: float | None = Field(default=None, ge=0)  # AUD, per unit; None = priced with the bundle as a whole
    purchase_price: float | None = Field(default=None, ge=0)  # AUD, per unit
    # the cards / designs picked in this product, with their copies and optional per-copy prices
    card_quantities: dict[str, int] = Field(default_factory=dict)
    card_prices: dict[str, float] = Field(default_factory=dict)
    # physical parts of a set in this product (e.g. ["Storage Box", "Playmat"]) and their optional prices
    parts: list[str] = Field(default_factory=list)
    part_prices: dict[str, float] = Field(default_factory=dict)


class CollectionItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    kind: Kind = "card"
    name: str
    # Card-only attributes (null for general items)
    color: GundamColor | None = None
    card_type: CardType | None = None
    rarity: Rarity | None = None
    # Catalog link — set when the card was picked from the scraped card database
    card_id: str | None = None  # print id incl. parallel suffix, e.g. "GD01-001_p1"
    card_no: str | None = None  # number printed on the card, e.g. "GD01-001"
    set_code: str | None = None  # e.g. "GD01", "ST11"
    set_name: str | None = None  # e.g. "Newtype Rising", "Promotion card"
    product_id: str | None = None  # product-database id for items, e.g. "pb01", "sleeve01"
    edition: str | None = None  # e.g. "Regular Version" / "Special Edition" (ST01–ST04)
    part: str | None = None  # the piece of a set being sold, e.g. "Playmat" (PB01, PB02)
    resource_cards: list[str] = Field(default_factory=list)  # e.g. ["RP-025", "RP-027"] when part = Resources
    alt_art_cards: list[str] = Field(default_factory=list)  # e.g. ["ST02-010_p4"] when part = Alt-Art Cards
    # sleeve designs picked (Official Card Sleeves 01), by name, e.g. ["Gundam/EFSF"]
    sleeve_designs: list[str] = Field(default_factory=list)
    # copies per picked card or sleeve design, e.g. {"GD02-110_p3": 2, "ST05-010_p4": 1}; quantity is their total
    card_quantities: dict[str, int] = Field(default_factory=dict)
    # optional price per copy of a picked card / design (same keys as card_quantities); when set,
    # the listing is one lot and price is its total
    card_prices: dict[str, float] = Field(default_factory=dict)
    # optional price of each physical part in a part bundle (e.g. {"Storage Box": 25.0})
    part_prices: dict[str, float] = Field(default_factory=dict)
    # several products listed together (e.g. ST09 + ST01), each with an optional price
    bundle_items: list[BundleEntry] = Field(default_factory=list)
    # General-item-only attribute (null for cards)
    category: ItemCategory | None = None
    price: float = Field(default=0.0, ge=0)  # AUD, per-unit asking price
    purchase_price: float | None = Field(default=None, ge=0)  # AUD, per-unit cost basis
    image_url: str | None = None
    quantity: int = Field(default=1, ge=1)
    condition: str | None = None
    notes: str | None = None
    status: Status = "for_sale"
    # Deal record — filled when a sale moves to pending/sold
    buyer_name: str | None = None
    deal_date: str | None = None  # YYYY-MM-DD
    sale_price: float | None = None  # AUD, per unit (the deal dialog pre-fills the asking price)
    created_at: datetime = Field(default_factory=utcnow)
    sold_at: datetime | None = None
    # a sold record split off a listing by a partial sale: the listing's id (restoring merges it back)
    split_from: str | None = None
    position: int | None = None  # "My order" (drag and drop); None = never arranged, shown first
    # the stack (named group, see routers/stacks.py) this listing is in, if any
    stack_id: str | None = None


# Input-only limits: the read models (CollectionItem, BundleEntry) stay lenient, so a listing
# saved by an older version is never hidden for breaking a newer rule.
MAX_QTY = 9999  # copies in one listing or deal (1,000,000,000 used to be accepted and broke the totals)
MAX_PRICE = 1_000_000  # A$, per unit
Copies = dict[str, Annotated[int, Field(ge=1, le=MAX_QTY)]]
Prices = dict[str, Annotated[float, Field(ge=0, le=MAX_PRICE)]]
# web, app, or uploaded photo (compressed in the browser to ~200 KB; the cap stops oversized uploads)
ImageUrl = Annotated[str | None, Field(default=None, max_length=600_000, pattern=r"^(https?://|/|data:image/)")]
ShortText = Annotated[str | None, Field(default=None, max_length=200)]
LongText = Annotated[str | None, Field(default=None, max_length=5000)]


def cents(v: float | None) -> float | None:
    """Money to the cent, rounding half up on the decimal value (1.005 → 1.01, not 1.00)."""
    return None if v is None else float(Decimal(str(v)).quantize(Decimal("0.01"), ROUND_HALF_UP))


# Emojis aren't allowed in what users type (names, buyers, notes, Stakks): they're removed.
# ★ ☆ © ® ™ stay (card names use them); text like :) stays as plain text.
_EMOJI = re.compile(
    "[\u231a-\u23ff\u24c2\u25aa-\u25fe\u2600-\u2604\u2607-\u2712\u2714-\u27bf\u2934\u2935\u2b05-\u2b55"
    "\u3030\u303d\u3297\u3299\U0001F000-\U0001FAFF\ufe0f\u20e3\u200d]"
)


def no_emoji(v: str | None, one_line: bool = True) -> str | None:
    if v is None:
        return None
    v = _EMOJI.sub("", v)
    return " ".join(v.split()) if one_line else v.strip()


class BundleEntryIn(BundleEntry):
    image_url: ImageUrl
    quantity: int = Field(default=1, ge=1, le=MAX_QTY)
    price: float | None = Field(default=None, ge=0, le=MAX_PRICE)
    purchase_price: float | None = Field(default=None, ge=0, le=MAX_PRICE)
    card_quantities: Copies = Field(default_factory=dict)
    card_prices: Prices = Field(default_factory=dict)
    part_prices: Prices = Field(default_factory=dict)

    @field_validator("price", "purchase_price")
    @classmethod
    def _cents(cls, v: float | None) -> float | None:
        return cents(v)  # kept to the cent, like the listing's own prices

    @field_validator("name", "detail")
    @classmethod
    def _no_emoji(cls, v: str | None) -> str | None:
        return no_emoji(v)


class ItemCreate(BaseModel):
    kind: Kind = "card"
    name: str = Field(max_length=500)
    color: GundamColor | None = None
    card_type: CardType | None = None
    rarity: Rarity | None = None
    category: ItemCategory | None = None
    card_id: str | None = None
    card_no: str | None = None
    set_code: str | None = None
    set_name: str | None = None
    product_id: str | None = None
    edition: str | None = None
    part: str | None = None
    resource_cards: list[str] = Field(default_factory=list)
    alt_art_cards: list[str] = Field(default_factory=list)
    sleeve_designs: list[str] = Field(default_factory=list)
    card_quantities: Copies = Field(default_factory=dict)
    card_prices: Prices = Field(default_factory=dict)
    part_prices: Prices = Field(default_factory=dict)
    bundle_items: list[BundleEntryIn] = Field(default_factory=list)
    price: float = Field(default=0.0, ge=0, le=MAX_PRICE)
    purchase_price: float | None = Field(default=None, ge=0, le=MAX_PRICE)
    image_url: ImageUrl
    quantity: int = Field(default=1, ge=1, le=MAX_QTY)
    condition: ShortText
    notes: LongText

    @field_validator("name", mode="after")
    @classmethod
    def _name_given(cls, v: str) -> str:
        v = no_emoji(v) or ""
        if not v:
            raise ValueError("enter a name")  # "   " (or only emojis) used to save as an empty name
        return v

    @field_validator("price", "purchase_price")
    @classmethod
    def _cents(cls, v: float | None) -> float | None:
        return cents(v)  # money is kept to the cent (0.005 → 0.01)

    @field_validator("name", "condition", "edition", "part")
    @classmethod
    def _no_emoji(cls, v: str | None) -> str | None:
        return no_emoji(v)

    @field_validator("notes")
    @classmethod
    def _notes_no_emoji(cls, v: str | None) -> str | None:
        return no_emoji(v, one_line=False)  # notes keep their line breaks


class ItemUpdate(ItemCreate):
    # Sold listings only: fix the deal (a typo in the sold price, buyer or date). Ignored otherwise.
    sale_price: float | None = Field(default=None, ge=0, le=MAX_PRICE)  # AUD, per unit
    buyer_name: ShortText
    deal_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    # What the edit form saw when it opened: if the listing has changed since (a sale, a move to
    # Storage in another tab), the save is refused instead of writing old values back.
    expected_status: Status | None = None
    expected_quantity: int | None = None

    @field_validator("deal_date")
    @classmethod
    def _real_date(cls, v: str | None) -> str | None:
        if v is not None:
            date.fromisoformat(v)
        return v

    @field_validator("sale_price")
    @classmethod
    def _sale_cents(cls, v: float | None) -> float | None:
        return cents(v)

    @field_validator("buyer_name")
    @classmethod
    def _buyer_no_emoji(cls, v: str | None) -> str | None:
        return no_emoji(v)


class StatusUpdate(BaseModel):
    status: Status
    buyer_name: ShortText
    deal_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    sale_price: float | None = Field(default=None, ge=0, le=MAX_PRICE)  # AUD, per unit
    quantity_sold: int | None = Field(default=None, ge=1, le=MAX_QTY)  # units in this deal (pending or sold); fewer than owned splits them off

    @field_validator("deal_date")
    @classmethod
    def _real_date(cls, v: str | None) -> str | None:
        if v is not None:
            date.fromisoformat(v)  # 2026-13-45 matches the pattern but isn't a date → 422
        return v

    @field_validator("sale_price")
    @classmethod
    def _sale_cents(cls, v: float | None) -> float | None:
        return cents(v)

    @field_validator("buyer_name")
    @classmethod
    def _buyer_no_emoji(cls, v: str | None) -> str | None:
        return no_emoji(v)


def _resource_listing_image(doc: dict) -> str | None:
    """Image for a multi-card "Resources" listing: a picture of just its selected cards.

    Listings saved by earlier versions pointed at the first card or the whole resource set;
    only those generated images are replaced — a photo URL the user typed in is kept.
    """
    cards = doc.get("resource_cards") or []
    product_id = doc.get("product_id")
    image = doc.get("image_url") or ""
    generated = image.startswith("/api/card-images/RP-") or (
        image.startswith("/api/product-images/") and "-resources.svg" in image
    )
    if doc.get("part") != "Resources" or len(cards) < 2 or not product_id or not generated:
        return None
    return f"/api/product-images/{product_id}-resources.svg?cards={','.join(cards)}"


_TRAILING_CODE_RE = re.compile(r"\s*\[(?P<code>[^\[\]]+)\]\s*$")  # search(), not a lazy .*? from the start


def code_first(name: str) -> str:
    """Product names lead with their code: "Heavy Dominion [ST14]" → "[ST14] Heavy Dominion".

    Names without a trailing [code], or that already start with one, are returned unchanged.
    """
    if not name or name.lstrip().startswith("["):
        return name
    m = _TRAILING_CODE_RE.search(name)
    if not m or not name[: m.start()].strip():
        return name
    return f"[{m.group('code').strip()}] {name[: m.start()].strip()}"


# Set parts that have their own photo (see PART_PHOTOS in lib/product_catalog.py).
_PART_PHOTO_PRODUCTS = {"pb01", "pb02", "pb03", "pc01a", "pc02a", "limitedbox-beta"}
# Bumped when the part photos change, so browsers that cached an older picture fetch the new one.
PART_PHOTO_VERSION = "10"
_PART_PHOTO_URL_RE = re.compile(r"^/api/product-images/([a-z0-9-]+)-part-[a-z0-9-]+\.svg(\?v=\w+)?$")
_PART_PHOTO_PARTS = {
    "Storage Box", "Sleeves", "Playmat", "Deck Box", "Separator",
    "Sleeves (Blue)", "Sleeves (Green)", "Card Case", "Damage Counter Dice",  # PB03
    "Booster Pack",  # Edition Beta
    "ASSEMBLE: Gundam Barbatos 4th Form", "ASSEMBLE: Graze Custom", "ASSEMBLE: CGS Mobile Worker",  # PC01A
    "ASSEMBLE: GQuuuuuuX (Omega Psycommu)", "ASSEMBLE: Red Gundam", "ASSEMBLE: GFreD",  # PC02A
}


def _part_photo_image(doc: dict) -> str | None:
    """A set-part listing gets the part's current photo (if it shows the whole set's box
    art, or an older version of the part photo). A photo the user chose is kept."""
    product_id, part = doc.get("product_id"), doc.get("part")
    if product_id not in _PART_PHOTO_PRODUCTS or part not in _PART_PHOTO_PARTS:
        return None
    image = doc.get("image_url") or ""
    if image != f"/api/product-images/{product_id}.webp" and not _PART_PHOTO_URL_RE.match(image):
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", part.lower()).strip("-")
    current = f"/api/product-images/{product_id}-part-{slug}.svg?v={PART_PHOTO_VERSION}"
    return None if image == current else current


def normalise_doc(doc: dict) -> dict:
    """Strip Mongo's _id and tz-normalise datetimes motor hands back naive."""
    doc.pop("_id", None)
    if doc.get("category") in LEGACY_CATEGORY:
        doc["category"] = LEGACY_CATEGORY[doc["category"]]
    if doc.get("rarity") in LEGACY_RARITY:
        doc["rarity"] = LEGACY_RARITY[doc["rarity"]]
    if doc.get("part") in LEGACY_PART:
        doc["part"] = LEGACY_PART[doc["part"]]
    if doc.get("product_id") in PRODUCT_CATEGORY_OVERRIDES:
        doc["category"] = PRODUCT_CATEGORY_OVERRIDES[doc["product_id"]]
    # Items from the product database (starter decks, accessories, Premium Bandai, other)
    # show their code first — also for listings saved before this was the naming style.
    if doc.get("kind") == "item" and doc.get("product_id") and doc.get("name"):
        doc["name"] = code_first(doc["name"])
    fixed_image = _resource_listing_image(doc) or _part_photo_image(doc)
    if fixed_image:
        doc["image_url"] = fixed_image
    for key in ("created_at", "sold_at"):
        value = doc.get(key)
        if isinstance(value, datetime) and value.tzinfo is None:
            doc[key] = value.replace(tzinfo=timezone.utc)
    return doc
