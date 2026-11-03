"""Back up the CardStakk database, or put a backup back. The free Atlas cluster keeps no backups of its own.

Run from backend/ with the venv on (uses MONGO_URL / DB_NAME from backend/.env):
    python backup_db.py                                          # saves backups/cardstakk-2026-11-03-0300.json.gz
    python backup_db.py restore backups/cardstakk-2026-11-03-0300.json.gz   # asks first

Saved: accounts, listings (with their photos), Stakks and Buy Me a Coffee members. Not saved: log-in sessions and
email links, so after a restore everyone just logs in again. The newest 30 backups are kept.
A backup holds emails and password hashes: keep it on your PC (backups/ is in .gitignore), never share it.
"""

import gzip
import os
import sys
from datetime import datetime
from pathlib import Path

from bson import json_util  # comes with pymongo: keeps dates as dates
from dotenv import load_dotenv
from pymongo import MongoClient

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")
FOLDER = HERE / "backups"
COLLECTIONS = ("users", "items", "stacks", "bmc_members")
KEEP = 30


def database():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def summary(data: dict) -> str:
    return ", ".join(f"{len(docs)} {name}" for name, docs in data.items())


def backup() -> Path:
    db = database()
    data = {name: list(db[name].find({}, {"_id": 0})) for name in COLLECTIONS}
    FOLDER.mkdir(exist_ok=True)
    path = FOLDER / f"cardstakk-{datetime.now():%Y-%m-%d-%H%M%S}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(json_util.dumps(data))
    for old in sorted(FOLDER.glob("cardstakk-*.json.gz"))[:-KEEP]:
        old.unlink()
    print(f"Saved {path.name}: {summary(data)}")
    return path


def restore(file: str) -> None:
    with gzip.open(file, "rt", encoding="utf-8") as f:
        data = {k: v for k, v in json_util.loads(f.read()).items() if k in COLLECTIONS}
    print(f"In {Path(file).name}: {summary(data)}")
    if input("This REPLACES the accounts, listings, Stakks and members in the database with that backup. Type restore: ").strip() != "restore":
        print("Cancelled. Nothing changed.")
        return
    print("First, a backup of the database as it is now:")
    backup()
    db = database()
    for name, docs in data.items():
        db[name].delete_many({})
        if docs:
            db[name].insert_many(docs)
    print(f"Restored: {summary(data)}. Everyone needs to log in again.")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        backup()
    elif len(sys.argv) == 3 and sys.argv[1] == "restore":
        restore(sys.argv[2])
    else:
        sys.exit(__doc__)
