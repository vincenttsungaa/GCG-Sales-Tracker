"""Collection inventory CRUD + sale-lifecycle transitions."""

import asyncio
import smtplib
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
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


@router.get("/items", response_model=list[CollectionItem])
async def list_items():
    docs = await db.items.find().sort("created_at", -1).to_list(2000)
    return [CollectionItem(**normalise_doc(doc)) for doc in docs]


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
    # Older clients don't send the catalog link — keep it rather than wiping it.
    for key in ("card_id", "card_no", "set_code", "set_name", "product_id", "edition", "part", "resource_cards", "alt_art_cards", "sleeve_designs", "card_quantities", "card_prices", "part_prices", "bundle_items"):
        if payload.get(key) in (None, [], {}):
            payload[key] = doc.get(key)
    payload.update(
        id=item_id,
        status=doc["status"],
        buyer_name=doc.get("buyer_name"),
        deal_date=doc.get("deal_date"),
        sale_price=doc.get("sale_price"),
        created_at=doc["created_at"],
        sold_at=doc.get("sold_at"),
    )
    obj = CollectionItem(**normalise_doc(payload))
    await db.items.replace_one({"id": item_id}, obj.model_dump())
    return obj


@router.patch("/items/{item_id}/status", response_model=CollectionItem)
async def update_status(item_id: str, input: StatusUpdate):
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="item not found")

    update: dict = {"status": input.status}
    if input.status == "pending":
        update["buyer_name"] = input.buyer_name or doc.get("buyer_name")
        update["deal_date"] = input.deal_date or doc.get("deal_date")
        update["sale_price"] = (
            input.sale_price if input.sale_price is not None else doc.get("sale_price")
        )
        update["sold_at"] = None
    elif input.status == "sold":
        buyer = input.buyer_name or doc.get("buyer_name")
        deal_date = input.deal_date or doc.get("deal_date")
        if not buyer or not deal_date:
            raise HTTPException(
                status_code=422,
                detail="buyer name and deal date are required to mark an item as sold",
            )
        owned = doc["quantity"]
        qty_sold = input.quantity_sold if input.quantity_sold is not None else owned
        if qty_sold > owned:
            raise HTTPException(
                status_code=422,
                detail=f"cannot sell {qty_sold} units — only {owned} owned",
            )
        sold_fields = {
            "status": "sold",
            "buyer_name": buyer,
            "deal_date": deal_date,
            "sale_price": input.sale_price if input.sale_price is not None else doc.get("sale_price"),
            "sold_at": utcnow(),
        }
        if qty_sold == owned:
            update.update(sold_fields)
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
            await db.items.insert_one(record.model_dump())
            # The listing survives with the leftover units and a cleared deal record.
            update = {
                "quantity": owned - qty_sold,
                "status": "for_sale",
                "buyer_name": None,
                "deal_date": None,
                "sale_price": None,
                "sold_at": None,
            }
    elif input.status == "on_hold":
        # Held back from sale (e.g. reserved, or keeping it for now) — no deal; an optional
        # name of who it's held for is kept as the buyer.
        update["buyer_name"] = input.buyer_name
        update["deal_date"] = None
        update["sale_price"] = None
        update["sold_at"] = None
    else:  # for_sale — (re)listing or restoring clears the deal record
        update["buyer_name"] = None
        update["deal_date"] = None
        update["sale_price"] = None
        update["sold_at"] = None

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
        return await db.items.find().sort("created_at", -1).to_list(5000)
    docs = await db.items.find({"id": {"$in": ids}}).to_list(5000)
    order = {item_id: i for i, item_id in enumerate(ids)}
    return sorted((normalise_doc(d) for d in docs), key=lambda d: order.get(d["id"], len(order)))


@router.post("/items/export")
async def export_items(body: ExportRequest):
    """The listings as an .xlsx download."""
    items = await _export_items(body.ids)
    data = build_workbook([normalise_doc(dict(d)) for d in items])
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
    data = build_workbook([normalise_doc(dict(d)) for d in items])
    try:
        await asyncio.to_thread(send_workbook, body.to, data, export_filename(), len(items), body.note)
    except EmailNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except (smtplib.SMTPException, OSError) as e:
        raise HTTPException(status_code=502, detail=f"Could not send the email: {e}") from e
    return {"sent": True, "to": body.to, "count": len(items)}
