"""Buy Me a Coffee memberships → CardStakk plans, by email.

BMC calls POST /api/bmc/webhook when a membership starts, changes, is cancelled or paused (Settings →
Webhooks in BMC, with the Signing Secret in BMC_WEBHOOK_SECRET). Each call is checked against that
secret, saved in bmc_members (by the supporter's email), and applied to the confirmed CardStakk account
with the same email. Someone who joins before signing up gets their plan when they confirm their email.

- Plan: the level's name containing "Collector" or "Dealer".
- Active: the plan has no end date here (BMC renews it monthly). Cancelled: it ends at the end of the
  period paid for. Paused: it ends now.
- Test events (Send test event in BMC) are checked and logged, and change nothing.
"""

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from lib import auth
from lib.db import db
from lib.email_design import p, render, rows
from lib.membership import apply_bmc, day

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bmc", tags=["bmc"])

LEVELS = {"dealer": 2, "collector": 1}  # matched in the BMC level name
EVENTS = ("membership.started", "membership.updated", "membership.cancelled", "membership.paused")


def tier_for(level_name: str | None) -> int | None:
    name = (level_name or "").lower()
    return next((t for word, t in LEVELS.items() if word in name), None)


def _when(ts) -> datetime | None:
    """A BMC timestamp (Unix seconds; milliseconds tolerated) as naive UTC, like the rest of the database."""
    if not ts:
        return None
    ts = float(ts)
    if ts > 1e12:
        ts /= 1000
    return datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None)


def _yes(v) -> bool:
    return v is True or str(v).lower() == "true"


def member_state(kind: str, data: dict) -> tuple[bool, datetime | None]:
    """(active, until): active renews monthly with no end date; otherwise until is when the plan ends."""
    status = (data.get("status") or "").lower()
    ending = kind in ("membership.cancelled", "membership.paused") or status in ("canceled", "cancelled", "paused")
    ending = ending or _yes(data.get("canceled")) or _yes(data.get("cancel_at_period_end")) or _yes(data.get("paused"))
    if not ending:
        return True, None
    if kind == "membership.paused" or status == "paused" or _yes(data.get("paused")):
        return False, auth.utcnow()
    return False, _when(data.get("current_period_end")) or auth.utcnow()  # paid up to the end of this period


async def _tell_owner(subject: str, lines: list[tuple[str, str]], note: str) -> None:
    from routers.auth import _feedback_inbox  # the owner's inbox (FEEDBACK_EMAIL / ADMIN_EMAILS)

    inbox = _feedback_inbox()
    if inbox:
        text = "\n".join(f"{k}: {v}" for k, v in lines) + f"\n\n{note}"
        await auth.send_mail(inbox, f"[CardStakk] {subject}", text, render(eyebrow="Buy Me a Coffee", title=subject, body=[rows(lines), p(note)], why="Sent by CardStakk when a Buy Me a Coffee membership changes."))


@router.post("/webhook")
async def webhook(request: Request):
    secret = (os.environ.get("BMC_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook not set up.")
    raw = await request.body()
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, (request.headers.get("x-signature-sha256") or "").strip().lower()):
        raise HTTPException(status_code=401, detail="Bad signature.")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Not JSON.")
    kind, data = event.get("type"), event.get("data") or {}
    if kind not in EVENTS:
        return {"ok": True, "ignored": kind}  # donations, extras…: nothing to do
    if not event.get("live_mode", True):
        logger.info("BMC test event %s received and verified (nothing changed)", kind)
        return {"ok": True, "test": True}

    email = auth.norm_email(data.get("supporter_email") or "")
    level = data.get("membership_level_name")
    tier = tier_for(level)
    if not email or not tier:
        logger.warning("BMC %s: no email or unknown level %r", kind, level)
        await _tell_owner(f"Unknown Buy Me a Coffee level: {level}", [("Event", kind), ("Email", email or "—")],
                          'Level names must contain "Collector" or "Dealer". Set their plan by hand on the Support page.')
        return {"ok": True, "unmatched": True}

    created = int(event.get("created") or 0)
    old = await db.bmc_members.find_one({"email": email}, {"_id": 0, "created": 1})
    if old and old.get("created", 0) > created:  # a retry of an older event arriving late
        return {"ok": True, "stale": True}
    active, until = member_state(kind, data)
    await db.bmc_members.update_one(
        {"email": email},
        {"$set": {"email": email, "tier": tier, "active": active, "until": until, "level": level, "status": data.get("status"),
                  "subscription_id": data.get("id"), "name": data.get("supporter_name"), "created": created, "updated_at": auth.utcnow()}},
        upsert=True,
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        await apply_bmc(user)
    plan = auth.PLANS[tier]["name"]
    account = "confirmed CardStakk account" if user and user.get("email_verified") else (
        "account not confirmed yet: switches on when they confirm" if user else "no CardStakk account yet: switches on when they sign up and confirm")
    if kind == "membership.started" or kind == "membership.cancelled":
        await _tell_owner(
            f"{plan} {'started' if active else 'cancelled'}: {email}",
            [("Email", email), ("Plan", plan), ("Ends", day(until) if until else "Renews monthly"), ("Account", account)],
            "Nothing to do." if user and user.get("email_verified") else "If they use a different email on CardStakk, set their plan by hand on the Support page.",
        )
    logger.info("BMC %s %s → %s %s", kind, email, plan, "active" if active else f"ends {until}")
    return {"ok": True}
