"""Accounts and sign-in: email + password, the session cookie, and each user's own data.

- Passwords are stored only as scrypt hashes (Python's hashlib, no extra package).
- A session is a random token in an HttpOnly cookie; the database keeps only its SHA-256, so a
  leaked database can't be used to sign in. Sessions and one-time links expire by themselves
  (TTL indexes in lib/db.py).
- Every listing and Stakk carries `owner_id`. Routers use `mine.items` / `mine.stacks` instead of
  `db.items` / `db.stacks`: those add the signed-in user's id to every query and write, so one
  user can never read or change another's data, even by guessing ids.
- Listings from before accounts have no owner and stay hidden until the email in CLAIM_EMAIL
  signs in with a confirmed email address: they become that user's.

Settings (backend/.env): CLAIM_EMAIL, ADMIN_EMAILS, PERKS_EMAILS, APP_URL, COOKIE_SECURE,
and the SMTP_* lines (shared with "Export → email") for verification and password-reset emails.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import smtplib
import time
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from types import SimpleNamespace
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, Response

from lib.db import db
from lib.email_design import add_html

logger = logging.getLogger(__name__)

SESSION_COOKIE = "cs_session"
SESSION_DAYS = 30
VERIFY_HOURS = 72
RESET_HOURS = 1

# the signed-in user's id for this request (set by current_user, read by mine.*)
current_owner: ContextVar[str | None] = ContextVar("current_owner", default=None)


def utcnow() -> datetime:
    """Naive UTC, the way Mongo hands datetimes back."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def norm_email(email: str) -> str:
    return email.strip().lower()


def _emails(var: str) -> set[str]:
    return {norm_email(e) for e in os.environ.get(var, "").split(",") if e.strip()}


def is_admin(user: dict) -> bool:
    return user["email"] in (_emails("ADMIN_EMAILS") | _emails("CLAIM_EMAIL"))


# ---- plans: Free / Collector / Dealer (supporter memberships) ---------------------------------

# max_listings counts listings that aren't sold (a ×3 listing is one); None = unlimited
# price: A$ a month, paid as a Buy Me a Coffee membership (routers/bmc.py switches the plan on and off)
# Closed beta: no new accounts (testers use the beta accounts from beta_accounts.py). Set to False to open
# sign-ups again, together with CLOSED_BETA in frontend/src/pages/Landing.tsx.
CLOSED_BETA = True

PLANS = {
    0: {"name": "Free", "max_listings": 100, "price": 0},
    1: {"name": "Collector", "max_listings": 250, "price": 10},
    2: {"name": "Dealer", "max_listings": None, "price": 15},
}


def effective_tier(user: dict) -> int:
    """The plan a user has right now: a membership past its end date is Free again.
    The site owner (ADMIN_EMAILS / CLAIM_EMAIL) always has everything, and so do the accounts in
    PERKS_EMAILS (e.g. the developer's own collection) — those get every perk but no owner tools.
    The owner can view the site as a lower plan for testing (preview_tier, set on the Plans page)."""
    if is_admin(user):
        return user["preview_tier"] if user.get("preview_tier") in (0, 1) else 2
    if user["email"] in _emails("PERKS_EMAILS"):
        return 2
    tier = user.get("tier") or 0
    until = user.get("tier_until")
    if tier and until and until < utcnow():
        return 0
    return tier if tier in PLANS else 0


def listing_limit(user: dict) -> int | None:
    return PLANS[effective_tier(user)]["max_listings"]


# ---- passwords --------------------------------------------------------------------------

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str | None) -> bool:
    if not stored:
        # no account (or no password): still do the slow check, so the answer takes as long and nobody
        # can tell from the timing which emails have accounts
        hashlib.scrypt(password.encode(), salt=b"cardstakk-no-user", n=_N, r=_R, p=_P, dklen=32)
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


# ---- too many wrong passwords -----------------------------------------------------------

# ponytail: in-memory, per server process; a shared store (Mongo / Redis) if it ever runs on several
_fails: dict[str, list[float]] = {}
_WINDOW, _MAX_FAILS = 15 * 60, 8  # emails to one address: 8 per 15 minutes
LOGIN_TRIES = 5  # incorrect passwords for ONE account before its log-in locks for 15 minutes
LOCKED = "Too many incorrect attempts. Log-in is locked for 15 minutes — try again later, or reset your password."
# One network (an IP) is shared by everyone on the same Wi-Fi, so it gets a much higher limit: enough for a
# card shop or market full of people, low enough to stop someone trying passwords across many accounts.
NETWORK_TRIES = 30  # incorrect passwords from one network, any accounts, per 15 minutes
NETWORK_LOCKED = "Too many incorrect log-ins from this network. Try again in 15 minutes."
NETWORK_SIGNUPS = 20  # new accounts from one network per 15 minutes
NETWORK_EMAILS = 20  # "forgot password" emails asked for from one network per 15 minutes


def _recent(key: str) -> list[float]:
    now = time.time()
    _fails[key] = [t for t in _fails.get(key, []) if now - t < _WINDOW]
    return _fails[key]


def check_rate(*keys: str, limit: int = _MAX_FAILS, detail: str = "Too many attempts — wait 15 minutes and try again.") -> None:
    if any(len(_recent(key)) >= limit for key in keys):
        raise HTTPException(status_code=429, detail=detail)


def note_fail(*keys: str) -> None:
    for key in keys:
        _fails.setdefault(key, []).append(time.time())


def tries_left(*keys: str, limit: int) -> int:
    return max(0, min(limit - len(_recent(key)) for key in keys))


def clear_fails(*keys: str) -> None:
    for key in keys:
        _fails.pop(key, None)


def client_ip(request: Request) -> str:
    """The visitor's address. Behind Cloudflare every request comes from the tunnel on this machine, so
    Cloudflare's CF-Connecting-IP is used instead, but only with TRUST_CLOUDFLARE=true (the backend
    then must not be reachable except through Cloudflare, or anyone could fake the header)."""
    if os.environ.get("TRUST_CLOUDFLARE", "").lower() in ("1", "true", "yes"):
        ip = (request.headers.get("cf-connecting-ip") or "").strip()
        if ip:
            return ip
    return request.client.host if request.client else "?"


# ---- sessions ---------------------------------------------------------------------------


async def start_session(response: Response, user: dict) -> None:
    token = secrets.token_urlsafe(32)
    await db.sessions.insert_one(
        {"token_hash": _sha(token), "user_id": user["id"], "created_at": utcnow(), "expires_at": utcnow() + timedelta(days=SESSION_DAYS)}
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes"),
        path="/",
    )


async def end_session(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.sessions.delete_one({"token_hash": _sha(token)})
    response.delete_cookie(SESSION_COOKIE, path="/")


async def current_user(request: Request) -> dict:
    """The signed-in user (401 if none). Also scopes mine.items / mine.stacks to them."""
    token = request.cookies.get(SESSION_COOKIE)
    session = await db.sessions.find_one({"token_hash": _sha(token)}) if token else None
    if not session or session["expires_at"] < utcnow():
        raise HTTPException(status_code=401, detail="Please log in.")
    user = await db.users.find_one({"id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Please log in.")
    current_owner.set(user["id"])
    return user


async def require_admin(user: dict = Depends(current_user)) -> dict:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Only the site owner can do this.")
    return user


# ---- each user's own listings and Stakks ------------------------------------------------


class Owned:
    """A collection seen through the signed-in user: every filter and write carries their owner_id."""

    def __init__(self, name: str):
        self.name = name

    def _uid(self) -> str:
        uid = current_owner.get()
        if not uid:  # never fall back to everyone's data
            raise RuntimeError(f"{self.name}: no signed-in user for this request")
        return uid

    def _f(self, flt: dict | None) -> dict:
        return {**(flt or {}), "owner_id": self._uid()}

    def find(self, flt=None, *args, **kwargs):
        return db[self.name].find(self._f(flt), *args, **kwargs)

    async def find_one(self, flt=None, *args, **kwargs):
        return await db[self.name].find_one(self._f(flt), *args, **kwargs)

    async def insert_one(self, doc: dict, *args, **kwargs):
        doc["owner_id"] = self._uid()
        return await db[self.name].insert_one(doc, *args, **kwargs)

    async def replace_one(self, flt, doc: dict, *args, **kwargs):
        return await db[self.name].replace_one(self._f(flt), {**doc, "owner_id": self._uid()}, *args, **kwargs)

    async def update_one(self, flt, update, *args, **kwargs):
        return await db[self.name].update_one(self._f(flt), update, *args, **kwargs)

    async def update_many(self, flt, update, *args, **kwargs):
        return await db[self.name].update_many(self._f(flt), update, *args, **kwargs)

    async def delete_one(self, flt, *args, **kwargs):
        return await db[self.name].delete_one(self._f(flt), *args, **kwargs)

    async def delete_many(self, flt, *args, **kwargs):
        return await db[self.name].delete_many(self._f(flt), *args, **kwargs)

    async def count_documents(self, flt, *args, **kwargs):
        return await db[self.name].count_documents(self._f(flt), *args, **kwargs)


# routers import this as `db`: `from lib.auth import mine as db`
mine = SimpleNamespace(items=Owned("items"), stacks=Owned("stacks"))


async def claim_unowned(user: dict) -> None:
    """Listings and Stakks from before accounts go to CLAIM_EMAIL, once its address is verified."""
    if not user.get("email_verified") or user["email"] not in _emails("CLAIM_EMAIL"):
        return
    for name in ("items", "stacks"):
        res = await db[name].update_many({"owner_id": {"$exists": False}}, {"$set": {"owner_id": user["id"]}})
        if res.modified_count:
            logger.info("gave %d unowned %s to %s", res.modified_count, name, user["email"])


# ---- users ------------------------------------------------------------------------------


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name"),
        "picture": user.get("picture"),
        "avatar": user.get("avatar"),  # the profile picture picked on the Account page, e.g. "avatar-01"
        "email_verified": bool(user.get("email_verified")),
        "has_password": bool(user.get("password_hash")),
        "is_admin": is_admin(user),
        "previewing": is_admin(user) and user.get("preview_tier") in (0, 1),
        "tier": effective_tier(user),
        "plan": PLANS[effective_tier(user)]["name"],
        "listing_limit": listing_limit(user),
        # Founding Supporter: set by the owner with backend/set_founding.py; the badge shows while on a paid plan
        "founding": bool(user.get("founding")) and effective_tier(user) > 0,
        "tier_until": user["tier_until"].isoformat() + "Z" if user.get("tier_until") else None,
        "created_at": user["created_at"].isoformat() + "Z" if user.get("created_at") else None,  # shown as "Joined …"
        "beta_feedback_sent": bool(user.get("beta_feedback_sent")),  # the beta form then asks about bugs only
    }


def new_user(email: str, **fields) -> dict:
    return {
        "id": str(uuid4()),
        "email": norm_email(email),
        "name": None,
        "picture": None,
        "password_hash": None,
        "email_verified": False,
        "tier": 0,  # Free; supporter memberships set 1 or 2 (with tier_until)
        "tier_until": None,
        "created_at": utcnow(),
        **fields,
    }


# ---- one-time links: confirm email, reset password --------------------------------------


async def make_link_token(user: dict, kind: str, hours: int) -> str:
    token = secrets.token_urlsafe(32)
    await db.user_tokens.delete_many({"user_id": user["id"], "kind": kind})  # only the newest link works
    await db.user_tokens.insert_one(
        {"token_hash": _sha(token), "user_id": user["id"], "kind": kind, "expires_at": utcnow() + timedelta(hours=hours)}
    )
    return token


async def use_link_token(token: str, kind: str) -> dict | None:
    """The user a link belongs to; the link is used up. None when it's wrong, used or expired."""
    doc = await db.user_tokens.find_one_and_delete({"token_hash": _sha(token), "kind": kind})
    if not doc or doc["expires_at"] < utcnow():
        return None
    return await db.users.find_one({"id": doc["user_id"]}, {"_id": 0})


def app_url(request: Request) -> str:
    """Where emailed links point. Never just the request's Origin: a forged one would send the
    link (and its token) to someone else's site."""
    if os.environ.get("APP_URL"):
        return os.environ["APP_URL"].rstrip("/")
    allowed = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    origin = (request.headers.get("origin") or "").rstrip("/")
    return origin if origin in allowed else allowed[0]


# addresses that can never receive mail (the test accounts pytest signs up): log, don't send
_NO_MAIL = ("@example.com", "@example.org", "@example.net", ".test", ".invalid")


def _send(to: str, subject: str, body: str, reply_to: str | None = None, html: str | None = None, image: tuple[bytes, str] | None = None) -> None:
    """image: (bytes, "png" / "jpeg" / "webp"), attached as screenshot.<type> (feedback screenshots)."""
    host = os.environ.get("SMTP_HOST")
    if not host or to.lower().endswith(_NO_MAIL):
        # no mail server yet: the link goes to the server log, so local testing still works
        logger.warning("EMAIL (SMTP not set up) to %s — %s\n%s", to, subject, body)
        return
    port = int(os.environ.get("SMTP_PORT") or "587")
    user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, os.environ.get("SMTP_FROM") or user or "cardstakk@localhost", to
    if reply_to:
        msg["Reply-To"] = reply_to  # e.g. feedback: hitting Reply answers the person who sent it
    msg.set_content(body)
    if html:
        add_html(msg, html)  # the designed version (lib/email_design.py); the plain text stays for simple mail apps
    if image:
        msg.add_attachment(image[0], maintype="image", subtype=image[1], filename=f"screenshot.{'jpg' if image[1] == 'jpeg' else image[1]}")
    if os.environ.get("SMTP_SSL", "").lower() in ("1", "true", "yes") or port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)


_mail_tasks: set[asyncio.Task] = set()  # kept here so a sending task isn't dropped half-way


async def send_mail(to: str, subject: str, body: str, html: str | None = None) -> None:
    """Sends in the background: the request answers straight away instead of waiting for the mail
    server (seconds with Gmail), and a reply takes as long whether or not the account exists."""

    async def run() -> None:
        try:
            await asyncio.to_thread(_send, to, subject, body, None, html)
        except (smtplib.SMTPException, OSError) as e:
            logger.error("could not email %s: %s", to, e)

    task = asyncio.create_task(run())
    _mail_tasks.add(task)
    task.add_done_callback(_mail_tasks.discard)
