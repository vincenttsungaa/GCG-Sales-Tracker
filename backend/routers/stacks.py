"""Stacks: named groups of For Sale / Pending listings (a listing is in at most one stack)."""

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from lib.auth import PLANS, current_user, effective_tier
from lib.auth import mine as db  # the signed-in user's own listings / Stakks only
from models.item import CollectionItem, StatusUpdate, no_emoji, normalise_doc, utcnow

router = APIRouter(tags=["stacks"])


class Stack(BaseModel):
    id: str
    name: str


class StackIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, v: str) -> str:
        v = no_emoji(v) or ""  # emojis are removed, like everywhere users type
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


class StackOrder(BaseModel):
    ids: list[str] = Field(max_length=500)  # every stack id, in the order to show them


@router.get("/stacks", response_model=list[Stack])
async def list_stacks():
    # in the order the user dragged them; stacks never reordered (no "order" yet) first, oldest first
    docs = await db.stacks.find({}, {"_id": 0}).to_list(None)
    return sorted(docs, key=lambda s: (s.get("order", -1), str(s.get("created_at", ""))))


@router.post("/stacks/order", response_model=list[Stack])
async def reorder_stacks(body: StackOrder):
    """Save the order of the sidebar's stacks (drag and drop)."""
    for i, stack_id in enumerate(body.ids):
        await db.stacks.update_one({"id": stack_id}, {"$set": {"order": i}})
    return await list_stacks()


async def _next_order() -> int:
    docs = await db.stacks.find({}, {"_id": 0, "order": 1}).to_list(None)
    return max((s.get("order", -1) for s in docs), default=-1) + 1  # after the last one, even after deletes


@router.post("/stacks", response_model=Stack, status_code=201)
async def create_stack(body: StackIn, user: dict = Depends(current_user)):
    # each plan has room for so many Stakks; an account already over (after a downgrade) keeps them all
    plan = PLANS[effective_tier(user)]
    if plan["max_stakks"] is not None and await db.stacks.count_documents({}) >= plan["max_stakks"]:
        raise HTTPException(
            status_code=403,
            detail=f"You've reached the {plan['max_stakks']}-Stakk limit on the {plan['name']} plan. Delete a Stakk you don't need, or see the Support page for more.",
        )
    if await _name_taken(body.name):
        raise HTTPException(status_code=409, detail=f"there's already a stack called “{body.name}”")
    stack = {"id": str(uuid4()), "name": body.name, "created_at": utcnow(), "order": await _next_order()}  # new ones go last
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


class StackStatus(BaseModel):
    status: Literal["on_hold", "for_sale"]  # whole stack to Storage, or back to For Sale


@router.post("/stacks/{stack_id}/status")
async def move_stack(stack_id: str, body: StackStatus):
    """Move a whole stack: its For Sale listings to Storage, or its Storage listings back to For Sale.

    Pending listings (with a buyer) are left as they are. Each listing goes through the normal status
    change, so units split off by a partial deal merge back into their listing as usual. They keep
    their stack.
    """
    from routers.items import update_status  # same rules as moving one listing

    if not await db.stacks.find_one({"id": stack_id}):
        raise HTTPException(status_code=404, detail="stack not found")
    source = "for_sale" if body.status == "on_hold" else "on_hold"
    docs = await db.items.find({"stack_id": stack_id, "status": source}).to_list(None)
    docs.sort(key=lambda d: bool(d.get("split_from")))  # originals first, so split-off units can merge back into them
    moved = 0
    for doc in docs:
        try:
            await update_status(doc["id"], StatusUpdate(status=body.status))
            moved += 1
        except HTTPException:
            pass  # merged into another listing already, or changed meanwhile — skip it
    return {"moved": moved}
