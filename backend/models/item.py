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
Rarity = Literal["C", "C+", "C++", "UC", "UC+", "R", "R+", "LR", "LR+", "LR++", "SP", "P", "LK"]
ItemCategory = Literal[
    "booster box", "playmat", "sleeves", "deck box", "binder", "model kit", "other"
]


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
    for key in ("created_at", "sold_at"):
        value = doc.get(key)
        if isinstance(value, datetime) and value.tzinfo is None:
            doc[key] = value.replace(tzinfo=timezone.utc)
    return doc
