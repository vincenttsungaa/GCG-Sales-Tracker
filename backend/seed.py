"""Seed sample Gundam collection data. Idempotent — skips when items exist.

Run: cd /app/backend && python seed.py
"""

import asyncio
from datetime import datetime, timedelta, timezone

from lib.db import db, ensure_indexes
from models.item import CollectionItem

MECHA_FIGURE_URL = "https://images.unsplash.com/photo-1571757767119-68b8dbed8c97?q=80&w=800&auto=format&fit=crop"
GUNDAM_AERIAL_URL = "https://images.unsplash.com/photo-1755853913084-c55e7ef1746d?q=80&w=800&auto=format&fit=crop"


def days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


def date_str(n: int) -> str:
    return days_ago(n).strftime("%Y-%m-%d")


SEED: list[dict] = [
    # --- Cards ---
    dict(name="RX-78-2 Gundam", kind="card", color="white", card_type="unit", rarity="LR",
         price=120.0, purchase_price=85.0, quantity=1, condition="Near Mint",
         notes="GD-001 starter box icon card", status="for_sale", created_at=days_ago(28)),
    dict(name="Amuro Ray", kind="card", color="white", card_type="pilot", rarity="R+",
         price=35.5, purchase_price=22.0, quantity=2, condition="Mint",
         notes="Two copies, both sleeve-protected", status="for_sale", created_at=days_ago(27)),
    dict(name="Char Aznable", kind="card", color="red", card_type="pilot", rarity="LR++",
         price=210.0, purchase_price=150.0, quantity=1, condition="Mint",
         notes="Graded-style sleeve, centreing 9/10", status="pending",
         buyer_name="Dylan T.", deal_date=date_str(2), sale_price=200.0, created_at=days_ago(25)),
    dict(name="MSN-04 Sazabi", kind="card", color="red", card_type="unit", rarity="SP",
         price=180.0, purchase_price=120.0, image_url=MECHA_FIGURE_URL, quantity=1,
         condition="Near Mint", notes="Metallic foil from booster 2 box",
         status="for_sale", created_at=days_ago(24)),
    dict(name="Wing Gundam Zero", kind="card", color="blue", card_type="unit", rarity="LK",
         price=95.0, purchase_price=60.0, image_url=GUNDAM_AERIAL_URL, quantity=1,
         condition="Excellent", notes="Link card from the EW set",
         status="for_sale", created_at=days_ago(22)),
    dict(name="Strike Freedom Gundam", kind="card", color="purple", card_type="unit", rarity="LR+",
         price=88.0, quantity=1, condition="Mint", notes="",
         status="for_sale", created_at=days_ago(20)),
    dict(name="Turn A Gundam", kind="card", color="white", card_type="unit", rarity="R",
         price=42.0, quantity=1, condition="Good", notes="Light edge wear on the bottom right",
         status="for_sale", created_at=days_ago(18)),
    dict(name="GUNDAM Aerial", kind="card", color="purple", card_type="unit", rarity="U+",
         price=18.0, quantity=3, condition="Mint", notes="Witch from Mercury set, playset",
         status="for_sale", created_at=days_ago(17)),
    dict(name="Nu Gundam", kind="card", color="white", card_type="unit", rarity="LR+",
         price=110.0, purchase_price=80.0, quantity=1, condition="Near Mint",
         notes="Char's Counterattack promo", status="sold", buyer_name="Sarah K.",
         deal_date=date_str(6), sale_price=105.0, created_at=days_ago(15)),
    dict(name="Emergency Repair", kind="card", color="green", card_type="command", rarity="C",
         price=4.5, quantity=4, condition="Played", notes="Binder bulk",
         status="for_sale", created_at=days_ago(14)),
    dict(name="Supply Depot", kind="card", color="blue", card_type="resource", rarity="C",
         price=3.0, quantity=6, condition="Excellent", notes="",
         status="for_sale", created_at=days_ago(13)),
    dict(name="Alexandria-class", kind="card", color="blue", card_type="ex base", rarity="U",
         price=12.0, quantity=1, condition="Near Mint", notes="EX base with token marker",
         status="for_sale", created_at=days_ago(12)),
    dict(name="Psycho Frame", kind="card", color="purple", card_type="ex resource", rarity="U",
         price=15.0, quantity=2, condition="Mint", notes="",
         status="for_sale", created_at=days_ago(11)),
    dict(name="White Base", kind="card", color="white", card_type="base", rarity="R+",
         price=55.0, quantity=1, condition="Mint", notes="Base card from the EFSF starter",
         status="for_sale", created_at=days_ago(10)),
    dict(name="Mass Production Type Token", kind="card", color="green", card_type="unit token",
         rarity="C++", price=2.0, quantity=5, condition="Excellent", notes="Token cards",
         status="for_sale", created_at=days_ago(9)),
    # --- General items ---
    dict(name="9-Pocket Card Binder", kind="item", category="accessories",
         price=25.0, purchase_price=15.0, quantity=1, condition="Excellent",
         notes="Holds 360 cards", status="sold", buyer_name="Mitch R.",
         deal_date=date_str(9), sale_price=25.0, created_at=days_ago(8)),
    dict(name="Gundam Sleeves (100ct)", kind="item", category="accessories",
         price=12.0, purchase_price=6.0, quantity=2, condition="Mint",
         notes="One pack opened, one sealed", status="for_sale", created_at=days_ago(7)),
    dict(name="HGUC RX-78-2 Model Kit", kind="item", category="other",
         price=30.0, purchase_price=22.0, quantity=1, condition="Mint",
         notes="Unopened, box in shrink", status="for_sale", created_at=days_ago(6)),
    dict(name="Strike Freedom Playmat", kind="item", category="accessories",
         price=35.0, purchase_price=18.0, quantity=1, condition="Good",
         notes="Tournament playmat, slight curl", status="for_sale", created_at=days_ago(5)),
    dict(name="Wing Zero Booster Box", kind="item", category="other",
         price=140.0, purchase_price=100.0, quantity=1, condition="Mint",
         notes="Sealed JP first wave", status="pending", buyer_name="Dylan T.",
         deal_date=date_str(1), sale_price=135.0, created_at=days_ago(4)),
]


async def seed() -> None:
    count = await db.items.count_documents({})
    if count > 0:
        print(f"items collection already has {count} documents — skipping seed")
        return
    for entry in SEED:
        obj = CollectionItem(**entry)
        await db.items.insert_one(obj.model_dump())
    print(f"seeded {len(SEED)} items")
    await ensure_indexes()


if __name__ == "__main__":
    asyncio.run(seed())
