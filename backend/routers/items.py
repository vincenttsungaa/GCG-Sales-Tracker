"""Collection inventory CRUD + sale-lifecycle transitions."""

import asyncio
from datetime import datetime, timezone
import logging
import smtplib
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from lib.export import XLSX_MIME, EmailNotConfigured, build_workbook, export_filename, send_workbook
from models.item import (
    CollectionItem,
    ItemCreate,
    ItemUpdate,
    StatusUpdate,
    normalise_doc,
    utcnow,
)
from lib.auth import mine as db  # the signed-in user's own listings / Stakks only
from lib.auth import PLANS, current_user, effective_tier, listing_limit

router = APIRouter(tags=["items"])
logger = logging.getLogger(__name__)


@router.get("/items", response_model=list[CollectionItem])
async def list_items():
    docs = await db.items.find().sort("created_at", -1).to_list(None)
    items = []
    for doc in docs:
        # one unreadable record (a value an older version allowed) must not hide the rest
        try:
            items.append(CollectionItem(**normalise_doc(doc)))
        except ValidationError as e:
            logger.warning("skipping item %s: %s", doc.get("id"), e)
    return items


# one add at a time per account, so adds sent together can't all pass the limit check
# ponytail: per server process; a shared lock (or a counter in Mongo) if it ever runs on several
_add_locks: dict[str, asyncio.Lock] = {}


async def _unsold_keys() -> set[str]:
    docs = await db.items.find({"status": {"$ne": "sold"}}, {"_id": 0, "id": 1, "split_from": 1}).to_list(None)
    return {d.get("split_from") or d["id"] for d in docs}


async def _listing_count() -> int:
    """Unsold listings for the plan limit. Copies split off a listing (1 of 2 to Pending or Storage,
    or a restored sale that kept its own row) count as that same listing, so splitting never
    pushes anyone over their limit: only adding new cards does."""
    return len(await _unsold_keys())


async def _check_restore_limit(doc: dict, user: dict) -> None:
    """Bringing a sale back (Sold → For Sale, Pending or Storage) is a listing again: refused at the plan limit,
    like adding one, unless it goes back into a listing that's still there (then it isn't a new one)."""
    limit = listing_limit(user)
    if limit is None:
        return
    keys = await _unsold_keys()
    if (doc.get("split_from") or doc["id"]) not in keys and len(keys) >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"You've reached the {limit}-listing limit on the {PLANS[effective_tier(user)]['name']} plan — "
            "bringing this sale back would go over it. Upgrade on the Support page, or sell or delete a listing first.",
        )


@router.post("/items", response_model=CollectionItem, status_code=201)
async def create_item(input: ItemCreate, user: dict = Depends(current_user)):
    # each plan lists up to so many listings that aren't sold; existing ones are never touched
    _check_photos(user, input)
    limit = listing_limit(user) if user else None
    async with _add_locks.setdefault(user["id"], asyncio.Lock()):
        if limit is not None and await _listing_count() >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"You've reached the {limit}-listing limit on the {PLANS[effective_tier(user)]['name']} plan — "
                "upgrade on the Support page to add more.",
            )
        obj = CollectionItem(**input.model_dump())
        await db.items.insert_one(obj.model_dump())
    return obj


def _check_photos(user: dict, new: ItemCreate | ItemUpdate, old: dict | None = None) -> None:
    """Your own uploaded photos (stored in the database, up to ~600 KB each) only once your email is confirmed:
    stops throwaway sign-ups filling the database with pictures. Photos already on a listing can stay."""
    if user.get("email_verified"):
        return
    kept = {(old or {}).get("image_url")} | {b.get("image_url") for b in (old or {}).get("bundle_items") or []}
    urls = [new.image_url, *(b.image_url for b in new.bundle_items or [])]
    if any(u and u.startswith("data:") and u not in kept for u in urls):
        raise HTTPException(status_code=403, detail="Confirm your email first to add your own photos (check your inbox for the link).")


async def _load(item_id: str) -> dict:
    """The stored listing, with quantity / status / created_at filled in (and saved) when an old record
    lacks them — the list already shows those defaults, and the guarded writes below match on them."""
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="item not found")
    missing = {
        k: v for k, v in (("quantity", 1), ("status", "for_sale"), ("created_at", utcnow())) if doc.get(k) is None
    }
    if missing:
        await db.items.update_one({"id": item_id}, {"$set": missing})
        doc.update(missing)
    return doc


@router.put("/items/{item_id}", response_model=CollectionItem)
async def update_item(item_id: str, input: ItemUpdate, user: dict = Depends(current_user)):
    doc = await _load(item_id)
    _check_photos(user, input, doc)
    if "quantity" in input.model_fields_set and input.expected_quantity is None:
        # an edit form from before this check (a tab not reloaded) could write an old quantity back
        raise HTTPException(status_code=422, detail="this page is out of date — reload it and try again")
    stale = "this listing changed since you opened it — close the form, reload and try again"
    if (input.expected_status is not None and input.expected_status != doc["status"]) or (
        input.expected_quantity is not None and input.expected_quantity != doc.get("quantity")
    ):
        raise HTTPException(status_code=409, detail=stale)
    # The edit form only changes a sale record on a sold listing (see below).
    payload = input.model_dump(exclude={"expected_status", "expected_quantity"})
    # Any field the request leaves out keeps its stored value (fields it sends — even empty —
    # replace it). A record saved before a field existed has none: the model's default applies.
    for key in payload:
        if key not in input.model_fields_set and doc.get(key) is not None:
            payload[key] = doc[key]
    sold = doc["status"] == "sold"
    if sold:
        # Once sold, the asking price and the units sold are history; the deal itself can be fixed.
        payload["price"] = doc.get("price", payload["price"])
        payload["quantity"] = doc.get("quantity", payload["quantity"])
        if not (payload.get("buyer_name") or "").strip() or not payload.get("deal_date"):
            raise HTTPException(status_code=422, detail="a sold listing needs a buyer name and a deal date")
        payload["buyer_name"] = payload["buyer_name"].strip()
    payload.update(
        id=item_id,
        status=doc["status"],
        created_at=doc["created_at"],
        sold_at=doc.get("sold_at"),
        split_from=doc.get("split_from"),  # not part of the edit form — kept as they are
        stack_id=doc.get("stack_id"),
        position=doc.get("position"),
    )
    if not sold:  # the edit form never touches a pending deal
        payload.update(buyer_name=doc.get("buyer_name"), deal_date=doc.get("deal_date"), sale_price=doc.get("sale_price"))
    obj = CollectionItem(**normalise_doc(payload))
    # only if nothing changed it between the read above and this write
    res = await db.items.replace_one({"id": item_id, "status": doc["status"], "quantity": doc.get("quantity")}, obj.model_dump())
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail=stale)
    return obj


_ACTIVE = ("for_sale", "on_hold")  # listings restored units can merge into (not pending: that has a deal)
_SAME_LISTING = ("kind", "name", "product_id", "card_id", "card_no", "edition", "part", "price", "purchase_price", "image_url")


def _when(value) -> datetime | None:
    """A stored timestamp as a naive UTC datetime (old records may hold ISO strings)."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


async def _split_origin(doc: dict) -> dict | None:
    """The active listing a partial-sale record was split from, if it's still there.

    Records split before `split_from` existed are matched by what the split copied: the same
    listing fields, and created at the moment of the sale (a whole-sale record keeps the
    listing's own, earlier created_at, so it's restored as itself).
    """
    if doc.get("card_quantities") or len(doc.get("bundle_items") or []) > 1:
        return None  # bundles are never split
    if doc.get("split_from"):
        origin = await db.items.find_one({"id": doc["split_from"]})
        return origin if origin and origin["status"] in _ACTIVE else None
    created, sold = _when(doc.get("created_at")), _when(doc.get("sold_at"))
    if not created or not sold or abs((sold - created).total_seconds()) > 5:
        return None
    matches = await db.items.find({k: doc.get(k) for k in _SAME_LISTING}).sort("created_at", 1).to_list(None)
    return next((m for m in matches if m["id"] != doc["id"] and m["status"] in _ACTIVE and not m.get("card_quantities")), None)


@router.patch("/items/{item_id}/status", response_model=CollectionItem)
async def update_status(item_id: str, input: StatusUpdate, user: dict = Depends(current_user)):
    doc = await _load(item_id)

    if input.status == "sold" and doc["status"] == "sold":
        raise HTTPException(status_code=422, detail="this item is already sold")
    if doc["status"] == "sold" and input.status != "sold":
        # the same one-at-a-time lock as adding, so restores sent together can't all slip under the limit
        async with _add_locks.setdefault(user["id"], asyncio.Lock()):
            await _check_restore_limit(doc, user)
            return await _apply_status(item_id, doc, input)
    return await _apply_status(item_id, doc, input)


async def _apply_status(item_id: str, doc: dict, input: StatusUpdate) -> CollectionItem:

    update: dict = {"status": input.status}
    owned = doc["quantity"]
    units = input.quantity_sold
    if units is not None and input.status in ("pending", "sold", "on_hold"):
        if units > owned:
            raise HTTPException(status_code=422, detail=f"cannot sell {units} units — only {owned} owned")
        if units < owned and (doc.get("card_quantities") or len(doc.get("bundle_items") or []) > 1):
            # a bundle, or picked cards (e.g. RP-025 ×2, RP-027 ×1), goes as a whole
            raise HTTPException(
                status_code=422,
                detail="this listing is a bundle — it can only be sold, held or stored as a whole",
            )

    if input.status in ("pending", "on_hold") and units is not None and units < owned:
        # Pending / Storage for some of the units: they split off into their own record (like a
        # partial sale); the rest stay listed as they are. Back to For Sale merges them back.
        record = CollectionItem(**normalise_doc(dict(doc)))
        record.id = str(uuid4())
        record.quantity = units
        record.status = input.status
        record.buyer_name = input.buyer_name
        record.deal_date = input.deal_date if input.status == "pending" else None
        record.sale_price = input.sale_price if input.status == "pending" else None
        record.sold_at = None
        record.created_at = utcnow()
        record.split_from = item_id
        await db.items.insert_one(record.model_dump())
        res = await db.items.update_one(
            {"id": item_id, "quantity": owned, "status": doc["status"]},
            {"$set": {"quantity": owned - units}},
        )
        if res.modified_count == 0:
            await db.items.delete_one({"id": record.id})
            raise HTTPException(status_code=409, detail="this item just changed — reload and try again")
        update = {}
    elif input.status == "pending":
        update["buyer_name"] = input.buyer_name or doc.get("buyer_name")
        update["deal_date"] = input.deal_date or doc.get("deal_date")
        update["sale_price"] = (
            input.sale_price if input.sale_price is not None else doc.get("sale_price")
        )
        update["sold_at"] = None
    elif input.status == "sold":
        buyer = (input.buyer_name or doc.get("buyer_name") or "").strip()
        deal_date = input.deal_date or doc.get("deal_date")
        if not buyer or not deal_date:
            raise HTTPException(
                status_code=422,
                detail="buyer name and deal date are required to mark an item as sold",
            )
        qty_sold = units if units is not None else owned
        sold_fields = {
            "status": "sold",
            "buyer_name": buyer,
            "deal_date": deal_date,
            "sale_price": input.sale_price if input.sale_price is not None else doc.get("sale_price"),
            "sold_at": utcnow(),
        }
        # Only if nothing changed the listing since it was read (another tab, a double-click).
        unchanged = {"id": item_id, "quantity": owned, "status": doc["status"]}
        if qty_sold == owned:
            res = await db.items.update_one(unchanged, {"$set": sold_fields})
            if res.modified_count == 0:
                raise HTTPException(status_code=409, detail="this item just changed — reload and try again")
        else:
            # Partial sale: remaining units stay listed; the deal becomes its own
            # archived record (new id, quantity = units sold, its own sold_at).
            record = CollectionItem(**normalise_doc(dict(doc)))
            record.id = str(uuid4())
            record.quantity = qty_sold
            record.status = "sold"
            record.buyer_name = buyer
            record.deal_date = deal_date
            record.sale_price = sold_fields["sale_price"]
            record.sold_at = sold_fields["sold_at"]
            record.created_at = utcnow()
            record.split_from = item_id
            # sold record first: if the listing update then fails, nothing is lost
            await db.items.insert_one(record.model_dump())
            res = await db.items.update_one(
                unchanged,
                {"$set": {
                    "quantity": owned - qty_sold,
                    "status": "on_hold" if doc["status"] == "on_hold" else "for_sale",  # Storage stays in Storage
                    "buyer_name": None,
                    "deal_date": None,
                    "sale_price": None,
                    "sold_at": None,
                }},
            )
            if res.modified_count == 0:
                await db.items.delete_one({"id": record.id})
                raise HTTPException(status_code=409, detail="this item just changed — reload and try again")
        update = {}
    elif input.status == "on_hold":
        # Held back from sale (e.g. reserved, or keeping it for now) — no deal; an optional
        # name of who it's held for is kept as the buyer.
        update["buyer_name"] = input.buyer_name
        update["deal_date"] = None
        update["sale_price"] = None
        update["sold_at"] = None
    elif (
        doc["status"] in ("sold", "pending", "on_hold")
        and (origin := await _split_origin(doc))
        and origin["status"] == "for_sale"  # back For Sale only into a listing that's For Sale, never into Storage
        # and only while it's still the same as that listing: an edited record (condition, price…) stays its own
        and all(origin.get(k) == doc.get(k) for k in (*_SAME_LISTING, "condition"))
    ):
        # Restoring units split off by a partial sale, pending deal or storage: back into that listing
        # (qty 1 + 2 sold → qty 3 again) instead of becoming a second copy of it.
        # Remove this record first: a second click (or tab) then finds nothing to merge, so the units
        # can't be added twice. If the listing changed meanwhile, the record is put back.
        gone = await db.items.delete_one({"id": item_id, "status": doc["status"], "quantity": doc["quantity"]})
        if gone.deleted_count == 0:
            raise HTTPException(status_code=409, detail="this item just changed — reload and try again")
        res = await db.items.update_one(
            {"id": origin["id"], "quantity": origin["quantity"], "status": origin["status"]},
            {"$inc": {"quantity": doc["quantity"]}},
        )
        if res.modified_count == 0:
            await db.items.insert_one(doc)
            raise HTTPException(status_code=409, detail="that listing just changed — reload and try again")
        merged = await db.items.find_one({"id": origin["id"]})
        return CollectionItem(**normalise_doc(merged))
    else:  # for_sale — (re)listing or restoring clears the deal record
        update["buyer_name"] = None
        update["deal_date"] = None
        update["sale_price"] = None
        update["sold_at"] = None

    if update:
        await db.items.update_one({"id": item_id}, {"$set": update})
    fresh = await db.items.find_one({"id": item_id})
    if not fresh:
        raise HTTPException(status_code=404, detail="item not found")
    return CollectionItem(**normalise_doc(fresh))


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: str):
    result = await db.items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="item not found")
    return None


class BulkDelete(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


class ItemOrder(BaseModel):
    ids: list[str] = Field(max_length=20000)  # every listing id, in "My order"


@router.post("/items/order")
async def reorder_items(body: ItemOrder):
    """Save "My order" (drag and drop). Only listings whose place changed are written."""
    docs = await db.items.find({"id": {"$in": body.ids}}, {"_id": 0, "id": 1, "position": 1}).to_list(None)
    current = {d["id"]: d.get("position") for d in docs}
    moved = 0
    for i, item_id in enumerate(body.ids):
        if item_id in current and current[item_id] != i:
            await db.items.update_one({"id": item_id}, {"$set": {"position": i}})
            moved += 1
    return {"moved": moved}


@router.post("/items/bulk-delete")
async def bulk_delete_items(body: BulkDelete):
    """Delete several listings at once (the dashboard's Select mode); returns how many went."""
    result = await db.items.delete_many({"id": {"$in": list(dict.fromkeys(body.ids))}})
    return {"deleted": result.deleted_count}


# ---- export: an editable Excel workbook of the listings ---------------------------------


class ExportRequest(BaseModel):
    # the listings to export, in this order (the dashboard sends what's shown); empty = all
    ids: list[str] = Field(default_factory=list, max_length=20000)
    label: str | None = Field(default=None, max_length=80)  # what's in it, e.g. "For Sale, with your filters"
    per_stack: bool = False  # also a sheet for each stack


class EmailExportRequest(ExportRequest):
    note: str | None = Field(default=None, max_length=2000)  # a note to yourself, shown in the email


async def _export_workbook(body: ExportRequest, full: bool, currency: str | None = None) -> tuple[bytes, int]:
    items = [normalise_doc(dict(d)) for d in await _export_items(body.ids)]
    stacks = await db.stacks.find({}, {"_id": 0}).to_list(None)
    order = sorted(stacks, key=lambda s: (s.get("order", -1), str(s.get("created_at", ""))))  # sidebar order
    names = {s["id"]: s["name"] for s in order}
    # Free: one Listings sheet. Collector and up: Summary, Listings, Sales and (if asked) a sheet per Stakk
    data = await asyncio.to_thread(build_workbook, items, names, body.label, full and body.per_stack, full, currency)
    return data, len(items)


async def _export_items(ids: list[str]) -> list[dict]:
    if not ids:
        return await db.items.find().sort("created_at", -1).to_list(None)
    docs = await db.items.find({"id": {"$in": ids}}).to_list(None)
    order = {item_id: i for i, item_id in enumerate(ids)}
    return sorted((normalise_doc(d) for d in docs), key=lambda d: order.get(d["id"], len(order)))


@router.post("/items/export")
async def export_items(body: ExportRequest, user: dict = Depends(current_user)):
    """The listings as an .xlsx download. Collector: one Listings sheet; Dealer: the full workbook."""
    if effective_tier(user) < 1:
        raise HTTPException(status_code=403, detail="Excel export comes with the Collector plan — see the Support page.")
    data, _ = await _export_workbook(body, full=effective_tier(user) >= 2, currency=user.get("currency"))
    name = export_filename(body.label)
    return Response(
        content=data,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/items/export/email")
async def email_export(body: EmailExportRequest, user: dict = Depends(current_user)):
    """Email the .xlsx to the account's own confirmed email (SMTP settings in backend/.env). Dealer."""
    if effective_tier(user) < 2:
        raise HTTPException(status_code=403, detail="Sending the export by email comes with the Dealer plan — see the Support page.")
    if not user.get("email_verified"):
        raise HTTPException(status_code=400, detail="Confirm your email first: the file is sent to your account's email.")
    data, count = await _export_workbook(body, full=True, currency=user.get("currency"))
    try:
        await asyncio.to_thread(
            send_workbook, user["email"], data, export_filename(body.label), count, body.note
        )
    except EmailNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except (smtplib.SMTPException, OSError) as e:
        logger.error("export email to %s failed: %s", user["email"], e)
        raise HTTPException(status_code=502, detail="Couldn't send the email right now — please try again later.") from e
    return {"sent": True, "to": user["email"], "count": count}
