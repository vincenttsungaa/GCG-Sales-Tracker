"""Take "Bundle: " off the front of bundle listing names (the card already says Bundle under the name).

Run from backend/ with the venv on:
    python strip_bundle_names.py

Covers every account's listings, sold ones included: "Bundle: GD01-001 + EXR-008" becomes
"GD01-001 + EXR-008". Shows what it will change and asks before saving. Safe to run again.
"""

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
PREFIX = "Bundle: "


def stripped(name: str) -> str:
    return name[len(PREFIX):].strip() if name.startswith(PREFIX) else name


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    found = [d async for d in db.items.find({"name": {"$regex": "^Bundle: "}}, {"id": 1, "name": 1})]
    found = [d for d in found if stripped(d["name"])]  # never leave a listing with no name
    if not found:
        print("No listing names start with \"Bundle: \". Nothing to change.")
        client.close()
        return
    for d in found:
        print(f"  {d['name']}  ->  {stripped(d['name'])}")
    if input(f"Rename these {len(found)} listings? Type yes: ").strip().lower() != "yes":
        print("Cancelled. Nothing changed.")
        client.close()
        return
    for d in found:
        await db.items.update_one({"id": d["id"]}, {"$set": {"name": stripped(d["name"])}})
    left = await db.items.count_documents({"name": {"$regex": "^Bundle: "}})
    print(f"Renamed {len(found)}." + ("" if left == 0 else f" {left} still start with \"Bundle: \"."))
    client.close()


if __name__ == "__main__":
    assert stripped("Bundle: GD01-001 + EXR-008") == "GD01-001 + EXR-008"
    assert stripped("Bundle:") == "Bundle:" and stripped("ST09") == "ST09"
    asyncio.run(main())
