"""Stacks: named groups of For Sale / Pending listings (a listing is in at most one stack)."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from lib.db import db
from models.item import CollectionItem, normalise_doc, utcnow

router = APIRouter(tags=["stacks"])


class Stack(BaseModel):
    id: str
    name: str


class StackIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("enter a name")
        return v


class MoveToStack(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    stack_id: str | None = None  # None = out of any stack


async def _name_taken(name: str, other_than: str | None = None) -> bool:
    for s in await db.stacks.find({}, {"_id": 0}).to_list(None):
        if s["name"].casefold() == name.casefold() and s["id"] != other_than:
            return True
    return False


@router.get("/stacks", response_model=list[Stack])
async def list_stacks():
    return await db.stacks.find({}, {"_id": 0}).sort("created_at", 1).to_list(None)


@router.post("/stacks", response_model=Stack, status_code=201)
async def create_stack(body: StackIn):
    if await _name_taken(body.name):
        raise HTTPException(status_code=409, detail=f"there's already a stack called “{body.name}”")
    stack = {"id": str(uuid4()), "name": body.name, "created_at": utcnow()}
    await db.stacks.insert_one(dict(stack))
    return stack


@router.patch("/stacks/{stack_id}", response_model=Stack)
async def rename_stack(stack_id: str, body: StackIn):
    if await _name_taken(body.name, stack_id):
        raise HTTPException(status_code=409, detail=f"there's already a stack called “{body.name}”")
    res = await db.stacks.update_one({"id": stack_id}, {"$set": {"name": body.name}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="stack not found")
    return {"id": stack_id, "name": body.name}


@router.delete("/stacks/{stack_id}", status_code=204)
async def delete_stack(stack_id: str):
    """Delete the stack only — its listings stay, just out of any stack."""
    res = await db.stacks.delete_one({"id": stack_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="stack not found")
    await db.items.update_many({"stack_id": stack_id}, {"$set": {"stack_id": None}})


@router.post("/stacks/assign", response_model=list[CollectionItem])
async def move_to_stack(body: MoveToStack):
    """Put listings into a stack (taking them out of their last one), or out of any (stack_id null)."""
    if body.stack_id is not None and not await db.stacks.find_one({"id": body.stack_id}):
        raise HTTPException(status_code=404, detail="stack not found")
    await db.items.update_many({"id": {"$in": body.ids}}, {"$set": {"stack_id": body.stack_id}})
    docs = await db.items.find({"id": {"$in": body.ids}}).to_list(None)
    return [CollectionItem(**normalise_doc(d)) for d in docs]
