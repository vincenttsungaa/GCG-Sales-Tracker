"""API tests for the items endpoints.

These run against the LIVE backend (see conftest.py), which uses the database in
backend/.env. Every item created here is named "__pytest__ <unique tag> ..." and is
deleted again after its test, including partial-sale records the backend creates by
itself. The tag is unique per test, so tests running in parallel (pytest.ini uses
2 workers) never delete each other's items.

Run from the backend folder, with the backend already running:
    pytest
"""

import os
import re
from uuid import uuid4

import httpx
import pytest

try:  # these hit the running backend; without one, skip instead of failing
    httpx.get(os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api/items", timeout=3)
except httpx.HTTPError:
    pytest.skip("backend not running on BACKEND_URL", allow_module_level=True)

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
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "pending", "buyer_name": "Test Buyer"})
        assert res.status_code == 200, res.text
        res = client.put(f"/items/{card['id']}", json=_payload(tag, price=20))
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["price"] == 20
        assert body["status"] == "pending"
        assert body["buyer_name"] == "Test Buyer"

    def test_update_keeps_fields_left_out(self, client, card):
        res = client.put(f"/items/{card['id']}", json={"name": card["name"], "price": 20})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["price"] == 20
        assert body["quantity"] == 3 and body["rarity"] == "R" and body["purchase_price"] == 5.0

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
        ("card_quantities", {"RP-025": 0}),
        ("card_prices", {"RP-025": -1}),
        ("image_url", "javascript:alert(1)"),
        ("notes", "x" * 5001),
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

    @pytest.mark.parametrize("body", [
        {"deal_date": "26/01/2026"},
        {"deal_date": "2026-13-45"},
        {"sale_price": -1},
        {"buyer_name": "   "},
    ])
    def test_sold_rejects_bad_deal(self, client, card, body):
        deal = {"status": "sold", "buyer_name": "Test Buyer", "deal_date": "2026-01-02", **body}
        assert client.patch(f"/items/{card['id']}/status", json=deal).status_code == 422
        assert next(i for i in client.get("/items").json() if i["id"] == card["id"])["status"] == "for_sale"

    def test_cannot_sell_twice(self, client, card):
        deal = {"status": "sold", "buyer_name": "Test Buyer", "deal_date": "2026-01-02"}
        assert client.patch(f"/items/{card['id']}/status", json=deal).status_code == 200
        assert client.patch(f"/items/{card['id']}/status", json=deal).status_code == 422

    def test_partial_sale_details_and_storage(self, client, tag, card):
        client.patch(f"/items/{card['id']}/status", json={"status": "on_hold"})
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "sale_price": 9, "quantity_sold": 1})
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "on_hold"  # leftovers stay in Storage
        assert res.json()["buyer_name"] is None
        sold = next(i for i in _test_items(client, tag) if i["status"] == "sold")
        assert (sold["buyer_name"], sold["deal_date"], sold["sale_price"]) == ("Test Buyer", "2026-01-02", 9)

    def test_no_partial_sale_of_picked_cards(self, client, tag):
        res = client.post("/items", json=_payload(tag, card_quantities={"RP-025": 2, "RP-027": 1}))
        item = res.json()
        res = client.patch(f"/items/{item['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "quantity_sold": 1})
        assert res.status_code == 422
        assert len(_test_items(client, tag)) == 1  # no sold record left behind

    def test_restoring_a_partial_sale_merges_back(self, client, tag, card):
        client.patch(f"/items/{card['id']}/status",
                     json={"status": "sold", "buyer_name": "Test Buyer",
                           "deal_date": "2026-01-02", "quantity_sold": 2})
        sold = next(i for i in _test_items(client, tag) if i["status"] == "sold")
        res = client.patch(f"/items/{sold['id']}/status", json={"status": "for_sale"})
        assert res.status_code == 200, res.text
        assert res.json()["id"] == card["id"] and res.json()["quantity"] == 3
        assert [i["id"] for i in _test_items(client, tag)] == [card["id"]]  # no second copy

    def test_pending_part_splits_and_merges_back(self, client, tag, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "pending", "buyer_name": "Test Buyer", "quantity_sold": 1})
        assert res.status_code == 200, res.text
        assert res.json()["quantity"] == 2 and res.json()["status"] == "for_sale"
        pending = next(i for i in _test_items(client, tag) if i["status"] == "pending")
        assert pending["quantity"] == 1 and pending["buyer_name"] == "Test Buyer"
        res = client.patch(f"/items/{pending['id']}/status", json={"status": "for_sale"})
        assert res.json()["id"] == card["id"] and res.json()["quantity"] == 3
        assert len(_test_items(client, tag)) == 1

    def test_storage_part_splits_and_merges_back(self, client, tag, card):
        res = client.patch(f"/items/{card['id']}/status", json={"status": "on_hold", "quantity_sold": 2})
        assert res.status_code == 200, res.text
        assert res.json()["quantity"] == 1 and res.json()["status"] == "for_sale"
        stored = next(i for i in _test_items(client, tag) if i["status"] == "on_hold")
        assert stored["quantity"] == 2
        res = client.patch(f"/items/{stored['id']}/status", json={"status": "for_sale"})
        assert res.json()["id"] == card["id"] and res.json()["quantity"] == 3
        assert len(_test_items(client, tag)) == 1

    def test_cannot_oversell(self, client, card):
        res = client.patch(f"/items/{card['id']}/status",
                           json={"status": "sold", "buyer_name": "Test Buyer",
                                 "deal_date": "2026-01-02", "quantity_sold": 5})
        assert res.status_code == 422


class TestStacks:
    def test_one_stack_at_a_time_and_delete_keeps_listings(self, client, tag, card):
        a = client.post("/stacks", json={"name": f"{tag}Sunday market"}).json()
        b = client.post("/stacks", json={"name": f"{tag}For Jake"}).json()
        try:
            assert client.post("/stacks", json={"name": f"{tag}SUNDAY MARKET"}).status_code == 409
            res = client.post("/stacks/assign", json={"ids": [card["id"]], "stack_id": a["id"]})
            assert res.status_code == 200 and res.json()[0]["stack_id"] == a["id"]
            client.post("/stacks/assign", json={"ids": [card["id"]], "stack_id": b["id"]})
            listed = next(i for i in client.get("/items").json() if i["id"] == card["id"])
            assert listed["stack_id"] == b["id"]  # moved, not in both
            # editing the listing keeps its stack
            assert client.put(f"/items/{card['id']}", json={"name": card["name"], "price": 9}).json()["stack_id"] == b["id"]
            assert client.delete(f"/stacks/{b['id']}").status_code == 204
            listed = next(i for i in client.get("/items").json() if i["id"] == card["id"])
            assert listed["stack_id"] is None  # the listing stays, out of any stack
        finally:
            for s in (a, b):
                client.delete(f"/stacks/{s['id']}")
