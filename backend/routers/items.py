"""Collection inventory CRUD + sale-lifecycle transitions."""

import asyncio
import logging
import smtplib
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field, ValidationError
from lib.export import XLSX_MIME, EmailNotConfigured, build_workbook, export_filename, send_workbook
from models.item import (
    CollectionItem,
    ItemCreate,
    ItemUpdate,
    StatusUpdate,
    normalise_doc,
    utcnow,
)
from lib.db import db

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


@router.post("/items", response_model=CollectionItem, status_code=201)
async def create_item(input: ItemCreate):
    obj = CollectionItem(**input.model_dump())
    await db.items.insert_one(obj.model_dump())
    return obj


@router.put("/items/{item_id}", response_model=CollectionItem)
async def update_item(item_id: str, input: ItemUpdate):
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="item not found")
    # The edit form does not touch the sale record — preserve it.
    payload = input.model_dump()
    # Any field the request leaves out keeps its stored value (fields it sends — even empty —
    # replace it). A record saved before a field existed has none: the model's default applies.
    for key in ItemUpdate.model_fields:
        if key not in input.model_fields_set and doc.get(key) is not None:
            payload[key] = doc[key]
    payload.update(
        id=item_id,
        status=doc["status"],
        buyer_name=doc.get("buyer_name"),
        deal_date=doc.get("deal_date"),
        sale_price=doc.get("sale_price"),
        created_at=doc["created_at"],
        sold_at=doc.get("sold_at"),
        split_from=doc.get("split_from"),  # not part of the edit form — kept as they are
        stack_id=doc.get("stack_id"),
    )
    obj = CollectionItem(**normalise_doc(payload))
    await db.items.replace_one({"id": item_id}, obj.model_dump())
    return obj


_ACTIVE = ("for_sale", "on_hold")  # listings restored units can merge into (not pending: that has a deal)
_SAME_LISTING = ("kind", "name", "product_id", "card_id", "card_no", "edition", "part", "price", "purchase_price", "image_url")


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
    created, sold = doc.get("created_at"), doc.get("sold_at")
    if not created or not sold or abs((sold - created).total_seconds()) > 5:
        return None
    matches = await db.items.find({k: doc.get(k) for k in _SAME_LISTING}).sort("created_at", 1).to_list(None)
    return next((m for m in matches if m["id"] != doc["id"] and m["status"] in _ACTIVE and not m.get("card_quantities")), None)


@router.patch("/items/{item_id}/status", response_model=CollectionItem)
async def update_status(item_id: str, input: StatusUpdate):
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="item not found")

    if input.status == "sold" and doc["status"] == "sold":
        raise HTTPException(status_code=422, detail="this item is already sold")

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
    elif doc["status"] in ("sold", "pending", "on_hold") and (origin := await _split_origin(doc)):
        # Restoring units split off by a partial sale, pending deal or storage: back into that listing
        # (qty 1 + 2 sold → qty 3 again) instead of becoming a second copy of it.
        res = await db.items.update_one(
            {"id": origin["id"], "quantity": origin["quantity"], "status": origin["status"]},
            {"$inc": {"quantity": doc["quantity"]}},
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=409, detail="that listing just changed — reload and try again")
        await db.items.delete_one({"id": item_id})
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


@router.post("/items/bulk-delete")
async def bulk_delete_items(body: BulkDelete):
    """Delete several listings at once (the dashboard's Select mode); returns how many went."""
    result = await db.items.delete_many({"id": {"$in": list(dict.fromkeys(body.ids))}})
    return {"deleted": result.deleted_count}


# ---- export: an editable Excel workbook of the listings ---------------------------------


class ExportRequest(BaseModel):
    # the listings to export, in this order (the dashboard sends what's shown); empty = all
    ids: list[str] = Field(default_factory=list, max_length=5000)


class EmailExportRequest(ExportRequest):
    to: EmailStr
    note: str | None = Field(default=None, max_length=2000)


async def _export_items(ids: list[str]) -> list[dict]:
    if not ids:
        return await db.items.find().sort("created_at", -1).to_list(None)
    docs = await db.items.find({"id": {"$in": ids}}).to_list(None)
    order = {item_id: i for i, item_id in enumerate(ids)}
    return sorted((normalise_doc(d) for d in docs), key=lambda d: order.get(d["id"], len(order)))


@router.post("/items/export")
async def export_items(body: ExportRequest):
    """The listings as an .xlsx download."""
    items = await _export_items(body.ids)
    data = await asyncio.to_thread(build_workbook, [normalise_doc(dict(d)) for d in items])
    name = export_filename()
    return Response(
        content=data,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/items/export/email")
async def email_export(body: EmailExportRequest):
    """Email the .xlsx to an address typed in by the user (SMTP settings in backend/.env)."""
    items = await _export_items(body.ids)
    data = await asyncio.to_thread(build_workbook, [normalise_doc(dict(d)) for d in items])
    try:
        await asyncio.to_thread(send_workbook, body.to, data, export_filename(), len(items), body.note)
    except EmailNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except (smtplib.SMTPException, OSError) as e:
        raise HTTPException(status_code=502, detail=f"Could not send the email: {e}") from e
    return {"sent": True, "to": body.to, "count": len(items)}
