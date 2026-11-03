"""Memberships: Buy Me a Coffee members' plans (apply_bmc), the "your membership is on" email, and a
reminder 5 days before a membership ends asking if they'd like to renew (checked every hour while the
server runs). Dates are shown in APP_TZ (e.g. 3 Dec 2026)."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from lib import auth
from lib.db import db
from lib.email_design import p, render, rows

logger = logging.getLogger(__name__)

REMIND_DAYS = 5
CHECK_EVERY = 3600  # seconds
BMC_URL = "https://buymeacoffee.com/cardstakk/membership"


def day(dt: datetime) -> str:
    """A stored (naive UTC) datetime as a date in APP_TZ: 3 Dec 2026."""
    local = dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(os.environ.get("APP_TZ", "UTC")))
    return f"{local.day} {local:%b %Y}"


async def send_enabled(user: dict, tier: int, since: datetime, until: datetime | None, base_url: str) -> None:
    plan = auth.PLANS[tier]["name"]
    # no end date = a Buy Me a Coffee membership, renewing every month until it's cancelled there
    ends = day(until) if until else "Renews monthly"
    after = (
        f"Nothing renews by itself: we'll email you {REMIND_DAYS} days before it ends, in case you'd like to keep it."
        if until
        else "It renews every month through Buy Me a Coffee. You can cancel there any time, and you keep it until the end of the month you paid for."
    )
    await auth.send_mail(
        user["email"],
        f"Your CardStakk {plan} membership is on",
        f"Thanks for supporting CardStakk! {plan} is now on for {user['email']}.\n\n"
        f"Started: {day(since)}\nEnds: {ends}\n\n{after} {base_url}",
        render(
            eyebrow="Membership on",
            title=f"{plan} is on. Thank you!",
            body=[
                p(f"Thanks for supporting CardStakk! {plan} is now switched on for {user['email']}. Everything it unlocks is ready to use."),
                rows([("Plan", plan), ("Started", day(since)), ("Ends", ends)]),
                p(after),
            ],
            button=("Open CardStakk", base_url),
            why="Sent because your CardStakk membership was switched on.",
        ),
    )


async def send_reminders(base_url: str) -> int:
    """Email everyone whose membership ends within REMIND_DAYS, once per end date."""
    now = auth.utcnow()
    cursor = db.users.find(
        {"tier": {"$in": [1, 2]}, "tier_until": {"$gt": now, "$lte": now + timedelta(days=REMIND_DAYS)}},
        {"_id": 0},
    )
    sent = 0
    async for user in cursor:
        if user.get("reminded_for") == user["tier_until"]:
            continue
        # mark first: a mail-server hiccup must never mean a reminder every hour
        await db.users.update_one({"id": user["id"]}, {"$set": {"reminded_for": user["tier_until"]}})
        plan = auth.PLANS[user["tier"]]["name"]
        ends = day(user["tier_until"])
        await auth.send_mail(
            user["email"],
            f"Your CardStakk {plan} membership ends on {ends}",
            f"Your {plan} membership ends on {ends}. Would you like to renew? Join {plan} again on Buy Me a Coffee "
            f"with this email: {BMC_URL}\n\nIf you don't, nothing is deleted: you go back to the Free plan.",
            render(
                eyebrow="Renew?",
                title=f"Your {plan} membership ends on {ends}",
                body=[
                    p(f"Thanks for supporting CardStakk. Would you like to keep {plan}? Join it again on Buy Me a Coffee "
                      f"with this email ({user['email']}) and it carries on by itself."),
                    rows([("Plan", plan), ("Ends", ends)]),
                    p("If you don't renew, nothing is deleted: you go back to the Free plan, and your listings stay."),
                ],
                button=("Renew on Buy Me a Coffee", BMC_URL),
                why=f"Sent {REMIND_DAYS} days before your CardStakk membership ends.",
            ),
        )
        sent += 1
    return sent


async def apply_bmc(user: dict) -> dict:
    """Give a confirmed account the plan its email has on Buy Me a Coffee (bmc_members, kept up to date by the
    webhook in routers/bmc.py). Called by the webhook, and when someone confirms their email (they may have
    joined on Buy Me a Coffee before signing up). Unconfirmed accounts get nothing: anyone can type any email.
    Returns the user as it is now."""
    if not user.get("email_verified"):
        return user
    m = await db.bmc_members.find_one({"email": user["email"]}, {"_id": 0})
    if not m:
        return user
    now = auth.utcnow()
    was_on = auth.effective_tier(user) == m["tier"] and not auth.is_admin(user)
    if m["active"]:
        # renews every month on BMC: no end date here; a cancel or pause sends the end date
        same = user.get("tier") == m["tier"] and (user.get("tier_until") is None or user["tier_until"] > now)
        fields = {"tier": m["tier"], "tier_until": None, "tier_since": (user.get("tier_since") or now) if same else now}
    else:
        until = m.get("until") if m.get("until") and m["until"] > now else now
        if user.get("tier") != m["tier"]:  # a different plan than BMC's: not ours to end
            return user
        fields = {"tier_until": until}
    await db.users.update_one({"id": user["id"]}, {"$set": fields})
    user = {**user, **fields}
    if m["active"] and not was_on:
        await send_enabled(user, m["tier"], fields["tier_since"], None, base_url())
    return user


def base_url() -> str:
    """Links in these emails (no request here): APP_URL, else the first CORS_ORIGINS entry."""
    url = os.environ.get("APP_URL") or os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")[0]
    return url.strip().rstrip("/")


async def reminder_loop() -> None:
    # ponytail: in-process hourly check; one server process only (a second would just find nothing left to send)
    while True:
        try:
            n = await send_reminders(base_url())
            if n:
                logger.info("sent %d membership reminders", n)
        except Exception:
            logger.exception("membership reminders failed")
        await asyncio.sleep(CHECK_EVERY)
