"""pytest fixtures for the FastAPI backend.

API tests (test_items.py, test_auth.py) hit the running backend at BACKEND_URL (default
localhost:8001), not an in-process app; they skip when it isn't running. The catalog tests
need no server.

Listings belong to accounts, so the API tests sign up a throwaway account (pytest-…@example.com)
and delete it — with everything it made — at the end. Your own listings are never touched.
"""

import os
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/items") -> http://localhost:8001/api/items."""
    return f"{API_URL}{path}"


def new_account(c: httpx.Client) -> str:
    """Sign up a throwaway account on this client (its cookie signs it in); returns the email."""
    email = f"pytest-{uuid4().hex[:12]}@example.com"
    c.password = f"pytest-{uuid4().hex}"  # kept on the client: deleting the account asks for it
    res = c.post("/auth/signup", json={"email": email, "password": c.password})
    assert res.status_code == 201, res.text
    return email


def delete_account(c: httpx.Client) -> None:
    """Delete the throwaway account this client signed up (and everything it made)."""
    c.request("DELETE", "/auth/me", json={"password": c.password})


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture(scope="session")
def session_cookies():
    """One throwaway account per test worker, deleted (with its listings) afterwards."""
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        try:
            new_account(c)
        except httpx.HTTPError:
            pytest.skip("backend not running on BACKEND_URL")
        yield dict(c.cookies)
        delete_account(c)


@pytest.fixture
def client(session_cookies):
    """Sync httpx client rooted at /api, signed in as the test account.

    Example:
        def test_status(client):
            assert client.get("/items").status_code == 200
    """
    with httpx.Client(base_url=API_URL, timeout=30.0, cookies=session_cookies) as c:
        yield c


@pytest_asyncio.fixture
async def aclient(session_cookies):
    """Async variant, for tests that also await motor/backend helpers directly."""
    async with httpx.AsyncClient(base_url=API_URL, timeout=30.0, cookies=session_cookies) as c:
        yield c
