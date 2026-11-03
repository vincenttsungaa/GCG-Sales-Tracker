"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "items": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("created_at", DESCENDING)], name="created_at"),  # list/export sort
        IndexModel([("buyer_name", ASCENDING)], name="buyer_name"),
        IndexModel([("deal_date", ASCENDING)], name="deal_date"),
        IndexModel([("owner_id", ASCENDING), ("created_at", DESCENDING)], name="owner_created"),  # each user's list
    ],
    "stacks": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("owner_id", ASCENDING)], name="owner_id"),
    ],
    # accounts (lib/auth.py)
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
    ],
    "sessions": [
        IndexModel([("token_hash", ASCENDING)], name="token_hash", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("expires_at", ASCENDING)], name="expires", expireAfterSeconds=0),  # Mongo removes old ones
    ],
    # Buy Me a Coffee members by email (routers/bmc.py), also for members who haven't signed up yet
    "bmc_members": [IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "user_tokens": [
        IndexModel([("token_hash", ASCENDING)], name="token_hash", unique=True),
        IndexModel([("user_id", ASCENDING)], name="user_id"),
        IndexModel([("expires_at", ASCENDING)], name="expires", expireAfterSeconds=0),
    ],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
