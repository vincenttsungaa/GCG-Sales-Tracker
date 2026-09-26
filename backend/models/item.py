"""Pydantic models for the unified collection inventory (cards + general items)."""

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

Kind = Literal["card", "item"]
Status = Literal["for_sale", "pending", "sold"]

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

# Categories from before the product database — mapped on read so old records still load.
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
    sale_price: float | None = None  # AUD, defaults to price when not overridden
    created_at: datetime = Field(default_factory=utcnow)
    sold_at: datetime | None = None


class ItemCreate(BaseModel):
    kind: Kind = "card"
    name: str
    color: GundamColor | None = None
    card_type: CardType | None = None
    rarity: Rarity | None = None
    category: ItemCategory | None = None
    card_id: str | None = None
    card_no: str | None = None
    set_code: str | None = None
    set_name: str | None = None
    product_id: str | None = None
    price: float = Field(default=0.0, ge=0)
    purchase_price: float | None = Field(default=None, ge=0)
    image_url: str | None = None
    quantity: int = Field(default=1, ge=1)
    condition: str | None = None
    notes: str | None = None


class ItemUpdate(ItemCreate):
    pass


class StatusUpdate(BaseModel):
    status: Status
    buyer_name: str | None = None
    deal_date: str | None = None
    sale_price: float | None = None  # AUD, per unit
    quantity_sold: int | None = Field(default=None, ge=1)  # partial sale: units in this deal


def normalise_doc(doc: dict) -> dict:
    """Strip Mongo's _id and tz-normalise datetimes motor hands back naive."""
    doc.pop("_id", None)
    if doc.get("category") in LEGACY_CATEGORY:
        doc["category"] = LEGACY_CATEGORY[doc["category"]]
    for key in ("created_at", "sold_at"):
        value = doc.get(key)
        if isinstance(value, datetime) and value.tzinfo is None:
            doc[key] = value.replace(tzinfo=timezone.utc)
    return doc
