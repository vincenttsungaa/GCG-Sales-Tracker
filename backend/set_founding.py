"""Mark an account as a Founding Supporter (gold badge on the landing-page supporter list and in the app),
or take it off. The badge shows only while that account is on a paid plan.
Limited: at most FOUNDING_LIMIT accounts can have it. Turning one off frees its place.

    python set_founding.py someone@example.com          # turn on
    python set_founding.py someone@example.com --off    # turn off
"""

import asyncio
import sys

from lib.auth import norm_email
from lib.db import db

FOUNDING_LIMIT = 10


async def main(email: str, on: bool) -> None:
    email = norm_email(email)
    user = await db.users.find_one({"email": email}, {"_id": 0, "founding": 1})
    if not user:
        sys.exit(f"No account for {email}")
    if on and not user.get("founding"):
        taken = await db.users.count_documents({"founding": True})
        if taken >= FOUNDING_LIMIT:
            sys.exit(f"All {FOUNDING_LIMIT} Founding Supporter places are taken. Turn one off first (--off).")
    await db.users.update_one({"email": email}, {"$set": {"founding": on}})
    taken = await db.users.count_documents({"founding": True})
    print(f"{email}: Founding Supporter {'on' if on else 'off'} ({taken} of {FOUNDING_LIMIT} places used)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], "--off" not in sys.argv))
