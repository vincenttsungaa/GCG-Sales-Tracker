"""One throwaway account for trying things out: confirmed, Free plan, kept off the supporter list.

Run from backend/ with the venv on (uses MONGO_URL / DB_NAME from backend/.env):
    python test_account.py              # makes test-xxxxxx@example.com and prints its password
    python delete_account.py test-xxxxxx@example.com   # when you're done

@example.com addresses never get mail: emails to it go to the backend log instead.
"""

import asyncio
import secrets

from lib.auth import hash_password, new_user
from lib.db import db

ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def main() -> None:
    email = f"test-{secrets.token_hex(3)}@example.com"
    password = "".join(secrets.choice(ALPHABET) for _ in range(12))
    user = new_user(email, name="Test Account", password_hash=hash_password(password), email_verified=True, test=True)
    await db.users.insert_one(dict(user))
    print(f"{email}  {password}\n\nFree plan, email confirmed. Delete it after: python delete_account.py {email}")


if __name__ == "__main__":
    asyncio.run(main())
