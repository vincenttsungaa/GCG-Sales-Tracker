"""Accounts: sign up, log in / out, and that one account never sees or changes another's listings.

Live backend, like test_items.py. Every account here is a throwaway (pytest-…@example.com) and is
deleted with everything it made.
"""

import httpx
import pytest

from tests.conftest import API_URL, delete_account, new_account

try:
    httpx.get(API_URL + "/", timeout=3)
except httpx.HTTPError:
    pytest.skip("backend not running on BACKEND_URL", allow_module_level=True)


@pytest.fixture
def user_a():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        c.email = new_account(c)
        yield c
        delete_account(c)


@pytest.fixture
def user_b():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        new_account(c)
        yield c
        delete_account(c)


def test_listings_need_a_login():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        assert c.get("/items").status_code == 401
        assert c.get("/stacks").status_code == 401
        assert c.get("/auth/me").status_code == 401


def test_signup_me_logout_login(user_a):
    me = user_a.get("/auth/me").json()
    assert me["email"] == user_a.email and me["has_password"] and not me["email_verified"]
    assert user_a.post("/auth/logout").status_code == 204
    assert user_a.get("/auth/me").status_code == 401
    bad = user_a.post("/auth/login", json={"email": user_a.email, "password": "wrong-password"})
    assert bad.status_code == 401


def test_same_email_twice(user_a):
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        res = c.post("/auth/signup", json={"email": user_a.email.upper(), "password": "another-password"})
        assert res.status_code == 409


def test_short_password_and_bad_email():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        assert c.post("/auth/signup", json={"email": "pytest-x@example.com", "password": "short"}).status_code == 422
        assert c.post("/auth/signup", json={"email": "not-an-email", "password": "long-enough-1"}).status_code == 422


def test_accounts_are_separate(user_a, user_b):
    item = user_a.post("/items", json={"kind": "card", "name": "__pytest__ private", "price": 1}).json()
    stack = user_a.post("/stacks", json={"name": "__pytest__ stakk"}).json()

    assert item["id"] in [i["id"] for i in user_a.get("/items").json()]
    assert item["id"] not in [i["id"] for i in user_b.get("/items").json()]
    assert stack["id"] not in [s["id"] for s in user_b.get("/stacks").json()]
    # B can't change, sell, move or delete A's listing, even knowing its id
    assert user_b.put(f"/items/{item['id']}", json={"kind": "card", "name": "x", "price": 2}).status_code == 404
    assert user_b.patch(f"/items/{item['id']}/status", json={"status": "on_hold"}).status_code == 404
    assert user_b.delete(f"/items/{item['id']}").status_code == 404
    assert user_b.post("/items/bulk-delete", json={"ids": [item["id"]]}).json()["deleted"] == 0
    assert user_b.post("/stacks/assign", json={"ids": [item["id"]], "stack_id": None}).json() == []
    assert user_b.delete(f"/stacks/{stack['id']}").status_code == 404
    # …and A still has both, unchanged
    mine = {i["id"]: i for i in user_a.get("/items").json()}
    assert mine[item["id"]]["price"] == 1 and mine[item["id"]]["status"] == "for_sale"


def test_forgot_password_never_tells(user_a):
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        known = c.post("/auth/forgot", json={"email": user_a.email})
        unknown = c.post("/auth/forgot", json={"email": "pytest-nobody@example.com"})
        assert known.json() == unknown.json() == {"sent": True}
        assert c.post("/auth/reset", json={"token": "x" * 40, "password": "new-password-1"}).status_code == 400

def test_plan_and_owner_tools(user_a):
    me = user_a.get("/auth/me").json()
    assert me["plan"] == "Free" and me["listing_limit"] == 100 and me["tier"] == 0
    # only the site owner can change plans
    res = user_a.post("/admin/tier", json={"email": user_a.email, "tier": 2})
    assert res.status_code == 403


def test_bmc_webhook_needs_a_signature():
    # unsigned or wrongly signed: refused (503 while BMC_WEBHOOK_SECRET isn't set), nothing changes
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        body = b'{"type":"membership.started","live_mode":true,"created":1,"data":{"supporter_email":"x@example.com"}}'
        assert c.post("/bmc/webhook", content=body).status_code in (401, 503)
        assert c.post("/bmc/webhook", content=body, headers={"x-signature-sha256": "00" * 32}).status_code in (401, 503)


def test_deleting_an_account_needs_its_password():
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        new_account(c)
        assert c.request("DELETE", "/auth/me", json={"password": "wrong-password"}).status_code == 401
        assert c.delete("/auth/me").status_code == 401  # no password at all
        assert c.get("/auth/me").status_code == 200  # still there
        assert c.request("DELETE", "/auth/me", json={"password": c.password}).status_code == 204
        assert c.get("/auth/me").status_code == 401


def test_own_photos_need_a_confirmed_email(user_a):
    photo = "data:image/webp;base64,UklGRg=="
    res = user_a.post("/items", json={"kind": "item", "name": "Photo test", "price": 1, "image_url": photo})
    assert res.status_code == 403  # new accounts aren't confirmed
    ok = user_a.post("/items", json={"kind": "item", "name": "Photo test", "price": 1, "image_url": "https://example.com/a.webp"})
    assert ok.status_code == 201  # a picture from the web is fine
