"""Sign up, log in (email + password), log out, confirm email, reset password."""

import asyncio
import os
import smtplib
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from lib import auth
from lib.auth import current_user, public_user
from lib.db import db
from lib.email_design import p, quote, render, rows
from lib.export import CURRENCIES
from lib.membership import apply_bmc
from models.item import no_emoji

router = APIRouter(prefix="/auth", tags=["auth"])

WRONG = "Email or password is incorrect."


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    name: str | None = Field(default=None, max_length=100)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(TokenIn):
    password: str = Field(min_length=8, max_length=200)


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


async def _send_verify(request: Request, user: dict) -> None:
    token = await auth.make_link_token(user, "verify", auth.VERIFY_HOURS)
    link = f"{auth.app_url(request)}/?verify={token}"
    name = (user.get("name") or "").strip()
    await auth.send_mail(
        user["email"],
        "Confirm your CardStakk email",
        f"Confirm your email for CardStakk:\n\n{link}\n\nThe link works for {auth.VERIFY_HOURS} hours. "
        "If you didn't sign up, ignore this email.",
        render(
            eyebrow="Welcome aboard",
            title=f"Confirm your email, {name}" if name else "Confirm your email",
            body=[p("One tap and your account is ready. Confirming means you can always get back in if you forget your password.")],
            button=("Confirm my email", link),
            fine=f"The link works for {auth.VERIFY_HOURS} hours.",
            why="You got this because someone signed up to CardStakk with this address. If it wasn't you, ignore it and nothing happens.",
        ),
    )


@router.post("/signup", status_code=201)
async def signup(body: SignupIn, request: Request, response: Response):
    if auth.CLOSED_BETA:
        raise HTTPException(status_code=403, detail="CardStakk is in closed beta: new accounts open soon.")
    email = auth.norm_email(body.email)
    auth.check_rate(f"signup:{auth.client_ip(request)}", limit=auth.NETWORK_SIGNUPS)
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists — log in instead.")
    user = auth.new_user(email, name=(body.name or "").strip() or None, password_hash=await asyncio.to_thread(auth.hash_password, body.password))
    await db.users.insert_one(dict(user))
    auth.note_fail(f"signup:{auth.client_ip(request)}")  # at most NETWORK_SIGNUPS per 15 minutes from one network
    await _send_verify(request, user)
    await auth.start_session(response, user)
    return public_user(user)


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = auth.norm_email(body.email)
    # each account: 5 wrong passwords lock it; each network (shared Wi-Fi): 30 wrong passwords, any accounts
    account, network = f"email:{email}", f"login-ip:{auth.client_ip(request)}"
    auth.check_rate(account, limit=auth.LOGIN_TRIES, detail=auth.LOCKED)
    auth.check_rate(network, limit=auth.NETWORK_TRIES, detail=auth.NETWORK_LOCKED)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    ok = await asyncio.to_thread(auth.check_password, body.password, user.get("password_hash") if user else None)
    if not user or not ok:
        auth.note_fail(account, network)
        left = auth.tries_left(account, limit=auth.LOGIN_TRIES)
        if not left:
            raise HTTPException(status_code=429, detail=auth.LOCKED)
        tries = "1 try" if left == 1 else f"{left} tries"
        raise HTTPException(status_code=401, detail=f"{WRONG} {tries} left before log-in is locked for 15 minutes.")
    auth.clear_fails(account)  # logged in: this account's count starts again (the network's count doesn't)
    await auth.claim_unowned(user)
    await auth.start_session(response, user)
    return public_user(user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response):
    await auth.end_session(request, response)


@router.post("/verify")
async def verify(body: TokenIn):
    user = await auth.use_link_token(body.token, "verify")
    if not user:
        raise HTTPException(status_code=400, detail="This link has expired or was already used.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True}})
    user["email_verified"] = True
    await auth.claim_unowned(user)
    user = await apply_bmc(user)  # a Buy Me a Coffee member who signed up after joining
    return public_user(user)


@router.post("/resend-verification")
async def resend_verification(request: Request, user: dict = Depends(current_user)):
    if user.get("email_verified"):
        return {"sent": False}
    auth.check_rate(f"verify:{user['id']}")
    auth.note_fail(f"verify:{user['id']}")
    await _send_verify(request, user)
    return {"sent": True}


@router.post("/forgot")
async def forgot(body: ForgotIn, request: Request):
    """Always the same answer, so nobody can find out which emails have accounts."""
    email = auth.norm_email(body.email)
    network = f"forgot-ip:{auth.client_ip(request)}"
    auth.check_rate(f"forgot:{email}")
    auth.check_rate(network, limit=auth.NETWORK_EMAILS)
    auth.note_fail(f"forgot:{email}", network)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        token = await auth.make_link_token(user, "reset", auth.RESET_HOURS)
        link = f"{auth.app_url(request)}/?reset={token}"
        await auth.send_mail(
            email,
            "Reset your CardStakk password",
            f"Set a new password for CardStakk:\n\n{link}\n\nThe link works for {auth.RESET_HOURS} hour. "
            "If you didn't ask for this, ignore this email — your password stays the same.",
            render(
                eyebrow="Password reset",
                title="Set a new password",
                body=[p("Someone (hopefully you) asked to reset the password for this account.")],
                button=("Choose a new password", link),
                fine=f"The link works for {auth.RESET_HOURS} hour and only once. If you didn't ask for this, ignore this email: your password stays the same.",
                why="Sent because a password reset was asked for on CardStakk.",
            ),
        )
    return {"sent": True}


@router.post("/reset")
async def reset(body: ResetIn, response: Response):
    user = await auth.use_link_token(body.token, "reset")
    if not user:
        raise HTTPException(status_code=400, detail="This link has expired or was already used — ask for a new one.")
    fields = {"password_hash": await asyncio.to_thread(auth.hash_password, body.password), "email_verified": True}
    await db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    await db.sessions.delete_many({"user_id": user["id"]})  # signed out everywhere else
    await auth.claim_unowned(user)
    user = await apply_bmc(user)
    await auth.start_session(response, user)
    return public_user(user)


# ---- the Account page: name, password, email, devices --------------------------------------


class NameIn(BaseModel):
    name: str = Field(max_length=60)


@router.get("/supporters")
async def supporters():
    """Public, for the landing page: the display names of everyone on a paid plan right now
    (Founding Supporters first, then Dealer, then Collector, longest-standing first). Names only: never emails or anything else.
    Owner, PERKS_EMAILS, beta-tester and test accounts aren't paying supporters, so they're left out."""
    now = auth.utcnow()
    cursor = db.users.find(
        {"tier": {"$in": [1, 2]}, "beta": {"$ne": True}, "test": {"$ne": True}, "name": {"$nin": [None, ""]}, "$or": [{"tier_until": None}, {"tier_until": {"$gt": now}}]},
        {"_id": 0, "email": 1, "name": 1, "tier": 1, "founding": 1, "created_at": 1},
    ).sort([("founding", -1), ("tier", -1), ("created_at", 1)])
    staff = auth._emails("ADMIN_EMAILS") | auth._emails("CLAIM_EMAIL") | auth._emails("PERKS_EMAILS")
    # ponytail: reads up to 500; paginate if the wall ever outgrows that
    return [
        {"name": u["name"], "tier": u["tier"], "founding": bool(u.get("founding"))}
        async for u in cursor.limit(500)
        if u["email"] not in staff
    ]


@router.patch("/me")
async def update_me(body: NameIn, user: dict = Depends(current_user)):
    """Display name: required (asked for right after sign-up); emojis are removed like everywhere else."""
    name = (no_emoji(body.name) or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"name": name}})
    return public_user({**user, "name": name})


class AvatarIn(BaseModel):
    # a picture's file name without its extension (frontend/src/assets/avatars); null = your initials
    avatar: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$")


class CurrencyIn(BaseModel):
    currency: Literal[tuple(CURRENCIES)]  # type: ignore[valid-type]


@router.put("/currency")
async def set_currency(body: CurrencyIn, user: dict = Depends(current_user)):
    """The money prices are shown in (and the Excel export uses). Display only: no amounts are converted."""
    await db.users.update_one({"id": user["id"]}, {"$set": {"currency": body.currency}})
    return public_user({**user, "currency": body.currency})


@router.put("/avatar")
async def set_avatar(body: AvatarIn, user: dict = Depends(current_user)):
    """Profile picture: one of the app's own pictures (no uploads), or none."""
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar": body.avatar}})
    return public_user({**user, "avatar": body.avatar})


def _check_current(user: dict, password: str, ok: bool) -> None:
    """Changing the password or email needs the current password, with the same 5-try lock as log-in."""
    key = f"account:{user['id']}"
    if ok:
        auth.clear_fails(key)
        return
    auth.note_fail(key)
    left = auth.tries_left(key, limit=auth.LOGIN_TRIES)
    if not left:
        raise HTTPException(status_code=429, detail=auth.LOCKED)
    tries = "1 try" if left == 1 else f"{left} tries"
    raise HTTPException(status_code=401, detail=f"Your current password is incorrect. {tries} left before it's locked for 15 minutes.")


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=8, max_length=200)


@router.post("/password")
async def change_password(body: PasswordIn, request: Request, user: dict = Depends(current_user)):
    """New password. Every other device is signed out; this one stays signed in."""
    auth.check_rate(f"account:{user['id']}", limit=auth.LOGIN_TRIES, detail=auth.LOCKED)
    ok = await asyncio.to_thread(auth.check_password, body.current, user.get("password_hash"))
    _check_current(user, body.current, ok)
    new_hash = await asyncio.to_thread(auth.hash_password, body.new)
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": new_hash}})
    this = auth._sha(request.cookies.get(auth.SESSION_COOKIE, ""))
    gone = await db.sessions.delete_many({"user_id": user["id"], "token_hash": {"$ne": this}})
    return {"changed": True, "signed_out": gone.deleted_count}


class EmailIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


@router.post("/email")
async def change_email(body: EmailIn, request: Request, user: dict = Depends(current_user)):
    """New email address: needs the current password; the new address has to be confirmed again."""
    auth.check_rate(f"account:{user['id']}", limit=auth.LOGIN_TRIES, detail=auth.LOCKED)
    ok = await asyncio.to_thread(auth.check_password, body.password, user.get("password_hash"))
    _check_current(user, body.password, ok)
    email = auth.norm_email(body.email)
    if email == user["email"]:
        raise HTTPException(status_code=400, detail="That's already your email.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Another account already uses that email.")
    old = user["email"]
    await db.users.update_one({"id": user["id"]}, {"$set": {"email": email, "email_verified": False}})
    user = {**user, "email": email, "email_verified": False}
    await _send_verify(request, user)
    # tell the old address too: if someone else changed it, the owner finds out straight away
    await auth.send_mail(
        old,
        "Your CardStakk email was changed",
        f"The email on your CardStakk account was changed from {old} to {email}.\n\n"
        f"If you did this, nothing more to do. If you didn't, reply to this email or write to {_feedback_inbox() or 'us'} straight away.",
        render(
            eyebrow="Account change",
            title="Your email was changed",
            body=[
                rows([("From", old), ("To", email), ("When", datetime.now().strftime("%d %b %Y, %H:%M"))]),
                p(f"If you did this, there's nothing more to do. If you didn't, reply to this email or write to {_feedback_inbox() or 'us'} straight away and we'll lock the account."),
            ],
            why="Sent to your old address because the email on your CardStakk account was changed.",
        ),
    )
    return public_user(user)


@router.get("/sessions")
async def sessions(user: dict = Depends(current_user)):
    """How many devices are signed in to this account (this one included)."""
    count = await db.sessions.count_documents({"user_id": user["id"], "expires_at": {"$gt": auth.utcnow()}})
    return {"count": count}


@router.post("/logout-others")
async def logout_others(request: Request, user: dict = Depends(current_user)):
    """Sign out every other device; this one stays signed in."""
    this = auth._sha(request.cookies.get(auth.SESSION_COOKIE, ""))
    gone = await db.sessions.delete_many({"user_id": user["id"], "token_hash": {"$ne": this}})
    return {"signed_out": gone.deleted_count}


# ---- feedback: a form on the Account page, emailed to the site owner -------------------------

FEEDBACK_TOPICS = (
    "Account and log-in",
    "Bug or something not working",
    "Question",
    "Idea or feature request",
    "Support and memberships",
    "Card or product information",
    "Other",
)


class FeedbackIn(BaseModel):
    topic: Literal[FEEDBACK_TOPICS]  # type: ignore[valid-type]
    message: str = Field(min_length=10, max_length=3000)


def _feedback_inbox() -> str | None:
    """FEEDBACK_EMAIL in backend/.env, else the first ADMIN_EMAILS address."""
    for var in ("FEEDBACK_EMAIL", "ADMIN_EMAILS"):
        first = (os.environ.get(var) or "").split(",")[0].strip()
        if first:
            return first
    return None


@router.post("/feedback")
async def send_feedback(body: FeedbackIn, user: dict = Depends(current_user)):
    """Email the feedback to the site owner, with Reply-To set to the sender's account email so the
    owner can answer by just hitting Reply. At most 5 messages per 15 minutes per account."""
    key = f"feedback:{user['id']}"
    auth.check_rate(key, limit=5, detail="That's a lot of feedback at once — please wait 15 minutes and try again.")
    message = no_emoji(body.message, one_line=False) or ""
    if len(message) < 10:
        raise HTTPException(status_code=422, detail="Write a little more (at least 10 characters).")
    inbox = _feedback_inbox()
    if not inbox:
        raise HTTPException(status_code=503, detail="Feedback isn't set up yet — try again later.")
    confirmed = "confirmed" if user.get("email_verified") else "NOT confirmed — check before replying"
    text = (
        f"Topic: {body.topic}\n"
        f"From: {user['email']} ({confirmed})\n"
        f"Name: {user.get('name') or '—'}\n"
        f"Plan: {public_user(user)['plan']}\n"
        f"Sent: {datetime.now().strftime('%d %b %Y, %H:%M')}\n"
        f"Account id: {user['id']}\n\n"
        f"{message}\n\n"
        "— Sent from the Feedback form in CardStakk. Reply to this email to answer them."
    )
    html = render(
        eyebrow="Feedback",
        title=body.topic,
        body=[
            rows([("From", user["email"]), ("Email", confirmed), ("Name", user.get("name") or "—"), ("Plan", public_user(user)["plan"]),
                  ("Sent", datetime.now().strftime("%d %b %Y, %H:%M")), ("Account id", user["id"])]),
            quote(message),
        ],
        why="Sent from the Feedback form in CardStakk. Reply to this email to answer them.",
    )
    try:  # sent now (not in the background) so the person knows whether it went through
        await asyncio.to_thread(auth._send, inbox, f"[CardStakk feedback] {body.topic} — {user['email']}", text, user["email"], html)
    except (smtplib.SMTPException, OSError):
        raise HTTPException(status_code=502, detail="Couldn't send your feedback right now — please try again later.")
    auth.note_fail(key)  # counts toward the 5-per-15-minutes limit
    return {"sent": True, "reply_to": user["email"]}


@router.get("/feedback/topics")
async def feedback_topics():
    return list(FEEDBACK_TOPICS)


class DeleteIn(BaseModel):
    password: str | None = Field(default=None, max_length=200)


@router.delete("/me", status_code=204)
async def delete_account(response: Response, body: DeleteIn | None = None, user: dict = Depends(current_user)):
    """Delete the account and everything in it: listings, Stakks, sessions. Needs the account's password
    (same 5-try lock as log-in), so someone using a phone that's still logged in can't wipe it."""
    if user.get("password_hash"):
        auth.check_rate(f"account:{user['id']}", limit=auth.LOGIN_TRIES, detail=auth.LOCKED)
        password = (body.password if body else None) or ""
        ok = await asyncio.to_thread(auth.check_password, password, user["password_hash"])
        _check_current(user, password, ok)
    for name in ("items", "stacks"):
        await db[name].delete_many({"owner_id": user["id"]})
    await db.sessions.delete_many({"user_id": user["id"]})
    await db.user_tokens.delete_many({"user_id": user["id"]})
    await db.users.delete_one({"id": user["id"]})
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
