"""Collection inventory CRUD + sale-lifecycle transitions."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException
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
