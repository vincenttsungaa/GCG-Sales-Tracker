"""Throwaway accounts for beta testers: already confirmed, with a name set, on the Free plan.
Run from backend/ with the venv on (uses MONGO_URL / DB_NAME from backend/.env).

    python beta_accounts.py create        # make 10 (cardstakk-beta01@example.com … beta10)
    python beta_accounts.py create 5      # make 5 more, numbered after the ones that exist
    python beta_accounts.py list          # who exists, their plan, how many listings each has
    python beta_accounts.py plan dealer   # put every beta account on Dealer (or: free / collector), no end date
    python beta_accounts.py delete        # remove every beta account and everything in it (asks first)

The emails and passwords are saved to backend/beta-accounts.csv (kept out of git) and printed here.
@example.com addresses never get mail, so testers can't reset a password: make a new account instead.
"""

import asyncio
import csv
import secrets
import sys
from pathlib import Path

from lib.auth import hash_password, new_user
from lib.db import db

CSV = Path(__file__).parent / "beta-accounts.csv"
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/l/I: easy to read out


def email_for(n: int) -> str:
    return f"cardstakk-beta{n:02d}@example.com"


async def create(count: int) -> None:
    taken = {u["email"] async for u in db.users.find({"beta": True}, {"email": 1})}
    made, n = [], 1
    while len(made) < count:
        email = email_for(n)
        n += 1
        if email in taken or await db.users.find_one({"email": email}):
            continue
        password = "".join(secrets.choice(ALPHABET) for _ in range(12))
        user = new_user(email, name=f"Beta Tester {n - 1:02d}", password_hash=hash_password(password), email_verified=True, beta=True)
        await db.users.insert_one(dict(user))
        made.append((email, password))
    new_file = not CSV.exists()
    with CSV.open("a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["email", "password"])
        w.writerows(made)
    for email, password in made:
        print(f"{email}  {password}")
    print(f"\nMade {len(made)} beta accounts. Saved to {CSV.name}.")


PLAN_TIERS = {"free": 0, "collector": 1, "dealer": 2}


async def show() -> None:
    async for u in db.users.find({"beta": True}).sort("email"):
        items = await db.items.count_documents({"owner_id": u["id"]})
        plan = next(k for k, v in PLAN_TIERS.items() if v == (u.get("tier") or 0)).title()
        print(f"{u['email']}  {plan}  {items} listings")


async def set_plan(name: str) -> None:
    if name not in PLAN_TIERS:
        sys.exit("Plan must be free, collector or dealer.")
    res = await db.users.update_many({"beta": True}, {"$set": {"tier": PLAN_TIERS[name], "tier_until": None}})
    print(f"{res.matched_count} beta accounts are now on {name.title()}.")


async def delete() -> None:
    users = [u async for u in db.users.find({"beta": True}, {"id": 1, "email": 1})]
    if not users:
        print("No beta accounts. Nothing deleted.")
        return
    ids = [u["id"] for u in users]
    items = await db.items.count_documents({"owner_id": {"$in": ids}})
    if input(f"Delete {len(users)} beta accounts and their {items} listings for good? Type yes: ").strip().lower() != "yes":
        print("Cancelled. Nothing deleted.")
        return
    await db.items.delete_many({"owner_id": {"$in": ids}})
    await db.stacks.delete_many({"owner_id": {"$in": ids}})
    await db.sessions.delete_many({"user_id": {"$in": ids}})
    await db.user_tokens.delete_many({"user_id": {"$in": ids}})
    await db.users.delete_many({"id": {"$in": ids}})
    CSV.unlink(missing_ok=True)
    print(f"Deleted {len(users)} beta accounts.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "create":
        asyncio.run(create(int(sys.argv[2]) if len(sys.argv) > 2 else 10))
    elif cmd == "plan" and len(sys.argv) > 2:
        asyncio.run(set_plan(sys.argv[2].lower()))
    elif cmd == "list":
        asyncio.run(show())
    elif cmd == "delete":
        asyncio.run(delete())
    else:
        sys.exit(__doc__)
