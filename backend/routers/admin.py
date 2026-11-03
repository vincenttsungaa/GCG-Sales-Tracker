"""Site-owner tools (ADMIN_EMAILS / CLAIM_EMAIL only): set an account's plan by hand.

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
