"""Site-owner tools (ADMIN_EMAILS / CLAIM_EMAIL only): set an account's plan by hand, and move one account's
listings, Stakks and plan into another account.

Buy Me a Coffee members are switched on and off by themselves (routers/bmc.py). This is for someone who
paid with a different email than their CardStakk account, and for testing what each plan unlocks.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from lib import auth
from lib.db import db
from lib.membership import send_enabled

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(auth.require_admin)])


class TierIn(BaseModel):
    email: EmailStr
    tier: int = Field(ge=0, le=2)  # 0 Free, 1 Collector, 2 Dealer
    months: int | None = Field(default=None, ge=1, le=36)  # none = until changed again


@router.post("/tier")
async def set_tier(body: TierIn, request: Request):
    """Set a plan. A paid plan emails the member that it's on, with its start and end dates."""
    user = await db.users.find_one({"email": auth.norm_email(body.email)}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="No CardStakk account uses that email.")
    now = auth.utcnow()
    # paying again before the end (same plan): the new month goes on after the current one, and it keeps its start date
    renewing = bool(body.tier) and body.tier == user.get("tier") and bool(user.get("tier_until")) and user["tier_until"] > now
    start = user["tier_until"] if renewing else now
    until = start + timedelta(days=31 * body.months) if body.tier and body.months else None
    since = (user.get("tier_since") or now) if renewing else now
    fields = {"tier": body.tier, "tier_until": until, "tier_since": since if body.tier else None}
    await db.users.update_one({"id": user["id"]}, {"$set": fields})
    if body.tier:
        await send_enabled(user, body.tier, since, until, auth.app_url(request))
    return auth.public_user({**user, **fields})


class PreviewIn(BaseModel):
    tier: int = Field(ge=0, le=2)  # 2 = back to the owner's normal (everything)


@router.post("/preview")
async def preview_tier(body: PreviewIn, me: dict = Depends(auth.require_admin)):
    """View the site as Free or Collector (limits included), to test what each plan gets."""
    preview = body.tier if body.tier < 2 else None
    await db.users.update_one({"id": me["id"]}, {"$set": {"preview_tier": preview}})
    return auth.public_user({**me, "preview_tier": preview})


class TransferIn(BaseModel):
    from_email: EmailStr
    to_email: EmailStr
    dry_run: bool = True  # just say what would happen
    confirm: str | None = None  # for the real move: the receiving email typed again


PLAN_FIELDS = ("tier", "tier_until", "tier_since", "founding")


@router.post("/transfer")
async def transfer(body: TransferIn):
    """Move everything from one account into another: the receiving account's own listings and Stakks are
    deleted first, then the other account's listings and Stakks become its own, and its plan (with end date
    and Founding badge) moves too. The account it came from is kept, empty, on Free.
    dry_run (the default) changes nothing and returns the counts, for the confirmation step."""
    src_email, dst_email = auth.norm_email(body.from_email), auth.norm_email(body.to_email)
    if src_email == dst_email:
        raise HTTPException(status_code=400, detail="Pick two different accounts.")
    src = await db.users.find_one({"email": src_email}, {"_id": 0})
    dst = await db.users.find_one({"email": dst_email}, {"_id": 0})
    if not src or not dst:
        raise HTTPException(status_code=404, detail=f"No CardStakk account uses {src_email if not src else dst_email}.")
    counts = {
        "moving_listings": await db.items.count_documents({"owner_id": src["id"]}),
        "moving_stakks": await db.stacks.count_documents({"owner_id": src["id"]}),
        "deleting_listings": await db.items.count_documents({"owner_id": dst["id"]}),
        "deleting_stakks": await db.stacks.count_documents({"owner_id": dst["id"]}),
        "plan": auth.PLANS[src.get("tier") or 0]["name"],
        "plan_until": src["tier_until"].isoformat() + "Z" if src.get("tier_until") else None,
        "founding": bool(src.get("founding")),
    }
    if body.dry_run:
        return {"done": False, **counts}
    if auth.norm_email(body.confirm or "") != dst_email:
        raise HTTPException(status_code=400, detail="Type the receiving account's email to confirm.")
    # ponytail: no transaction (Atlas free tier); each step is safe to run again if one fails half-way
    await db.items.delete_many({"owner_id": dst["id"]})
    await db.stacks.delete_many({"owner_id": dst["id"]})
    await db.items.update_many({"owner_id": src["id"]}, {"$set": {"owner_id": dst["id"]}})
    await db.stacks.update_many({"owner_id": src["id"]}, {"$set": {"owner_id": dst["id"]}})
    await db.users.update_one({"id": dst["id"]}, {"$set": {f: src.get(f) for f in PLAN_FIELDS}})
    await db.users.update_one({"id": src["id"]}, {"$set": {"tier": 0, "tier_until": None, "tier_since": None, "founding": False}})
    return {"done": True, **counts}
