"""Throwaway accounts for trying things out: confirmed, Free plan, kept off the supporter list.

Run from backend/ with the venv on (uses MONGO_URL / DB_NAME from backend/.env):
    python test_account.py                                   # makes test-xxxxxx@example.com and prints its password
    python test_account.py reset test-xxxxxx@example.com     # back to brand new: no listings, Free plan, same password
    python delete_account.py test-xxxxxx@example.com         # when you're done with it

@example.com addresses never get mail: emails to it go to the backend log instead.
Only accounts made here (marked as test accounts) can be reset.
"""

import asyncio
import secrets
import sys

from lib.auth import hash_password, new_user, norm_email
from lib.db import db

ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
# what a used account picks up along the way; a reset puts each back to how new_user() makes it
FRESH = {"name": "Test Account", "tier": 0, "tier_until": None, "tier_since": None, "founding": False, "avatar": None}
LEFTOVERS = ("plan_request", "preview_tier", "reminded_for")


async def create() -> None:
    email = f"test-{secrets.token_hex(3)}@example.com"
    password = "".join(secrets.choice(ALPHABET) for _ in range(12))
    user = new_user(email, name="Test Account", password_hash=hash_password(password), email_verified=True, test=True)
    await db.users.insert_one(dict(user))
    print(f"{email}  {password}\n\nFree plan, email confirmed. Delete it after: python delete_account.py {email}")


async def reset(email: str) -> None:
    email = norm_email(email)
    user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1, "test": 1})
    if not user:
        sys.exit(f"No account for {email}")
    if not user.get("test"):
        sys.exit(f"{email} isn't a test account (made by this script), so it isn't reset.")
    uid = user["id"]
    items = (await db.items.delete_many({"owner_id": uid})).deleted_count
    stakks = (await db.stacks.delete_many({"owner_id": uid})).deleted_count
    await db.sessions.delete_many({"user_id": uid})
    await db.user_tokens.delete_many({"user_id": uid})
    await db.bmc_members.delete_many({"email": email})
    await db.users.update_one({"id": uid}, {"$set": {**FRESH, "email_verified": True}, "$unset": {k: "" for k in LEFTOVERS}})
    print(f"{email} is like new: {items} listings and {stakks} Stakks removed, Free plan, logged out everywhere. Same password.")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        asyncio.run(create())
    elif len(sys.argv) == 3 and sys.argv[1] == "reset":
        asyncio.run(reset(sys.argv[2]))
    else:
        sys.exit(__doc__)
