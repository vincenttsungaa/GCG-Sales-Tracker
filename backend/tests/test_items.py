"""API tests for the items endpoints.

These run against the LIVE backend (see conftest.py), which uses the database in
backend/.env. Every item created here is named "__pytest__ <unique tag> ..." and is
deleted again after its test, including partial-sale records the backend creates by
itself. The tag is unique per test, so tests running in parallel (pytest.ini uses
2 workers) never delete each other's items.

Run from the backend folder, with the backend already running:
    pytest
"""

import re
from uuid import uuid4

import pytest

TEST_PREFIX = "__pytest__ "


def _payload(tag, **overrides):
    body = {
        "kind": "card",
        "name": f"{tag}Sazabi",
        "color": "red",
        "card_type": "unit",
        "rarity": "R",
        "price": 12.5,
        "purchase_price": 5.0,
        "quantity": 3,
    }
    body.update(overrides)
    return body


def _test_items(client, tag):
    return [i for i in client.get("/items").json() if i["name"].startswith(tag)]


@pytest.fixture
def tag(client):
    """A unique name prefix for this test; everything carrying it is deleted afterwards."""
    value = f"{TEST_PREFIX}{uuid4().hex[:8]} "
    yield value
    for item in _test_items(client, value):
        client.delete(f"/items/{item['id']}")


@pytest.fixture
def card(client, tag):
    res = client.post("/items", json=_payload(tag))
    assert res.status_code == 201, res.text
    return res.json()


class TestBasics:
    def test_health(self, client):
        res = client.get("/")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    def test_today_is_a_date(self, client):
        res = client.get("/today")
        assert res.status_code == 200
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", res.json()["today"])


class TestCrud:
    def test_create_defaults(self, card):
        assert card["status"] == "for_sale"
        assert card["kind"] == "card"
        assert card["quantity"] == 3
        assert card["buyer_name"] is None

    def test_create_item_kind(self, client, tag):
        res = client.post(
            "/items",
            json=_payload(tag, kind="item", name=f"{tag}Playmat", color=None,
                          card_type=None, rarity=None, category="accessories"),
        )
        assert res.status_code == 201, res.text
        assert res.json()["kind"] == "item"
        assert res.json()["category"] == "accessories"

    def test_listed(self, client, card):
        ids = [i["id"] for i in client.get("/items").json()]
        assert card["id"] in ids

    def test_update_keeps_deal_record(self, client, tag, card):
        client.patch(f"/items/{card['id']}/status",
                     json={"status": "pending", "buyer_name": "Test Buyer"})
        res = client.put(f"/items/{card['id']}", json=_payload(tag, price=20))
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["price"] == 20
        assert body["status"] == "pending"
        assert body["buyer_name"] == "Test Buyer"

    def test_delete(self, client, card):
        assert client.delete(f"/items/{card['id']}").status_code == 204
        assert client.delete(f"/items/{card['id']}").status_code == 404

    def test_unknown_id_404(self, client, tag):
        assert client.put("/items/does-not-exist", json=_payload(tag)).status_code == 404
        assert client.patch("/items/does-not-exist/status",
                            json={"status": "for_sale"}).status_code == 404


class TestValidation:
    @pytest.mark.parametrize("field,value", [
        ("color", "orange"),
        ("rarity", "XR"),
        ("kind", "sticker"),
        ("quantity", 0),
        ("price", -1),
    ])
    def test_rejects_bad_values(self, client, tag, field, value):
        res = client.post("/items", json=_payload(tag, **{field: value}))
        assert res.status_code == 422


class TestSaleLifecycle:
    def test_pending_then_restore_clears_deal(self, client, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "pending", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02"})
        assert res.json()["status"] == "pending"
        res = client.patch(f"/items/{card['id']}/status", json={"status": "for_sale"})
        body = res.json()
        assert body["status"] == "for_sale"
        assert body["buyer_name"] is None
        assert body["deal_date"] is None

    def test_sold_requires_buyer_and_date(self, client, card):
        res = client.patch(f"/items/{card['id']}/status", json={"status": "sold"})
        assert res.status_code == 422

    def test_sell_all(self, client, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "sale_price": 15})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "sold"
        assert body["sold_at"] is not None

    def test_partial_sale_splits_record(self, client, tag, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "quantity_sold": 2})
        assert res.status_code == 200, res.text
        listing = res.json()
        assert listing["status"] == "for_sale"
        assert listing["quantity"] == 1

        sold = [i for i in _test_items(client, tag) if i["status"] == "sold"]
        assert len(sold) == 1
        assert sold[0]["quantity"] == 2
        assert sold[0]["id"] != card["id"]

    def test_cannot_oversell(self, client, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "quantity_sold": 5})
        assert res.status_code == 422
