"""Delete one CardStakk account and everything it owns, straight from the database.

Run from backend/ with the venv on:
    python delete_account.py someone@example.com

Removes the user, its listings, Stakks, log-in sessions and email links (the same as an account
deleting itself). Uses MONGO_URL / DB_NAME from backend/.env. Asks before deleting.
"""

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")


async def main(email: str) -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    user = await db.users.find_one({"email": email.strip().lower()})
    if not user:
        print(f"No account uses {email}. Nothing deleted.")
        return
    uid = user["id"]
    counts = {
        "listings": await db.items.count_documents({"owner_id": uid}),
        "Stakks": await db.stacks.count_documents({"owner_id": uid}),
        "sessions": await db.sessions.count_documents({"user_id": uid}),
        "email links": await db.user_tokens.count_documents({"user_id": uid}),
    }
    print(f"Account {user['email']}: " + ", ".join(f"{n} {k}" for k, n in counts.items()))
    if input("Delete it and all of the above for good? Type yes: ").strip().lower() != "yes":
        print("Cancelled. Nothing deleted.")
        return
    await db.items.delete_many({"owner_id": uid})
    await db.stacks.delete_many({"owner_id": uid})
    await db.sessions.delete_many({"user_id": uid})
    await db.user_tokens.delete_many({"user_id": uid})
    await db.users.delete_one({"id": uid})
    left = await db.users.count_documents({"id": uid}) + await db.items.count_documents({"owner_id": uid})
    print("Deleted." if left == 0 else "Something was left behind — run it again.")
    client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python delete_account.py someone@example.com")
    asyncio.run(main(sys.argv[1]))
