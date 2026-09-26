"""Offline tests for the gundam-gcg.com product-list parser (no network, no backend needed)."""

from pathlib import Path

from lib import product_catalog as pc

FIX = Path(__file__).parent / "fixtures"


def _products():
    return pc.parse_list_page((FIX / "products_list.html").read_text(encoding="utf-8"))


def test_parse_list_page():
    items = {p["id"]: p for p in _products()}
    assert list(items) == ["gd06", "dice01", "pb01", "st01", "limitedbox-beta"]
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
    # ST01–ST04 come in two editions; single-price products have none
    assert items["st01"]["editions"] == [
        {"name": "Regular Version", "msrp": "$11.99"},
        {"name": "Special Edition", "msrp": "$34.99"},
    ]
    assert items["pb01"]["editions"] == []


def test_premium_bandai_parts_and_resource_cards():
    pb01 = pc.product_options("pb01")
    pb02 = pc.product_options("pb02")
    assert pb01["parts"] == ["Storage Box", "Sleeves", "Playmat", "Deck Box", "Resources", "Alt-Art Cards", "Divider"]
    assert pb01["resource_cards"][0] == "RP-024" and pb01["resource_cards"][-1] == "RP-033"
    assert len(pb01["resource_cards"]) == 10
    assert pb02["resource_cards"][0] == "RP-034" and pb02["resource_cards"][-1] == "RP-043"
    assert len(pb02["resource_cards"]) == 10
    assert pb01["alt_art_cards"] == ["ST02-010_p4", "GD01-100_p4"]
    assert pb02["alt_art_cards"] == ["GD02-110_p3", "ST05-010_p4"]
    assert pc.product_options("st01") == {"parts": [], "resource_cards": [], "alt_art_cards": []}


def test_resource_set_svg_layout():
    ten = {f"RP-{n:03d}": b"webp" for n in range(34, 44)}
    svg = pc.resource_set_svg("pb02", ten)
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert svg.count("<image ") == 10
    assert "data:image/webp;base64," in svg
    # a missing card image becomes a labelled placeholder tile instead of breaking the picture
    nine = {f"RP-{n:03d}": (None if n == 30 else b"webp") for n in range(25, 34)}
    svg = pc.resource_set_svg("pb01", nine)
    assert svg.count("<image ") == 8 and ">RP-030</text>" in svg


def test_resource_selection_only_uses_the_sets_own_cards(tmp_path, monkeypatch):
    monkeypatch.setattr(pc, "IMAGE_DIR", tmp_path)
    monkeypatch.setattr(pc.card_catalog, "download_image", lambda code, *a, **k: False)  # offline
    path = pc.ensure_resource_set_image("pb01", ["RP-031", "RP-025", "RP-099"])  # RP-099 isn't PB01's
    svg = path.read_text(encoding="utf-8")
    assert svg.index(">RP-025<") < svg.index(">RP-031<")  # set order, not click order
    assert "RP-099" not in svg
    assert pc.ensure_resource_set_image("pb01", ["RP-099"]) is None
    # PB01's alt-art cards can be pictured too (in configured order); not for PB02 (it has its own)
    svg = pc.ensure_resource_set_image("pb01", ["GD01-100_p4", "ST02-010_p4"]).read_text(encoding="utf-8")
    assert svg.index(">ST02-010_p4<") < svg.index(">GD01-100_p4<")
    assert pc.ensure_resource_set_image("pb02", ["ST02-010_p4"]) is None
    assert pc.ensure_resource_set_image("st01", ["RP-025"]) is None


def test_parse_editions_from_stored_msrp():
    assert [e["name"] for e in pc.parse_editions("REGULAR VERSION: $11.99 SPECIAL EDITION: $34.99")] == [
        "Regular Version",
        "Special Edition",
    ]
    assert pc.parse_editions("$15.99") == []
    assert pc.parse_editions(None) == []


def test_search(monkeypatch):
    products = [p for p in _products() if p["tag"] not in pc.EXCLUDED_TAGS]
    monkeypatch.setattr(pc, "load_catalog", lambda force=False: {"products": products})
    assert [p["id"] for p in pc.search_products("dice")] == ["dice01"]
    assert [p["id"] for p in pc.search_products("pb01")] == ["pb01"]
    assert [p["id"] for p in pc.search_products("", category="other")] == ["limitedbox-beta"]
