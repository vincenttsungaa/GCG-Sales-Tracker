"""Offline tests for the gundam-gcg.com product-list parser (no network, no backend needed)."""

from pathlib import Path

from lib import product_catalog as pc

FIX = Path(__file__).parent / "fixtures"


def _products():
    return pc.parse_list_page((FIX / "products_list.html").read_text(encoding="utf-8"))


def test_parse_list_page():
    items = {p["id"]: p for p in _products()}
    assert list(items) == ["gd06", "dice01", "pb01", "limitedbox-beta"]
    assert items["gd06"]["tag"] == "BOOSTERPACK"
    assert items["dice01"]["category"] == "accessories"
    assert items["dice01"]["msrp"] == "$14.99"
    assert items["dice01"]["release_date"] == "July 11, 2025"
    assert items["pb01"]["category"] == "premium bandai"
    assert items["pb01"]["code"] == "PB01"
    assert items["pb01"]["image_src"].startswith("https://www.gundam-gcg.com/gcg/bccard/")
    # untagged products fall back to "other"
    assert items["limitedbox-beta"]["category"] == "other"
    assert items["limitedbox-beta"]["msrp"] is None


def test_search(monkeypatch):
    products = [p for p in _products() if p["tag"] not in pc.EXCLUDED_TAGS]
    monkeypatch.setattr(pc, "load_catalog", lambda force=False: {"products": products})
    assert [p["id"] for p in pc.search_products("dice")] == ["dice01"]
    assert [p["id"] for p in pc.search_products("pb01")] == ["pb01"]
    assert [p["id"] for p in pc.search_products("", category="other")] == ["limitedbox-beta"]
