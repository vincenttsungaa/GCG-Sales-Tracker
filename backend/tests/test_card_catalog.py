"""Offline tests for the gundam-gcg.com parser (no network, no backend needed)."""

from pathlib import Path

from lib import card_catalog as cc

FIX = Path(__file__).parent / "fixtures"


def test_parse_packages_dedupes_and_unescapes():
    pk = cc.parse_packages((FIX / "packages.html").read_text(encoding="utf-8"))
    assert pk == [("616101", "Newtype Rising [GD01]"), ("616003", "Zeon's Rush [ST03]")]


def test_parse_list_ids():
    ids = cc.parse_list_ids((FIX / "packages.html").read_text(encoding="utf-8"))
    assert ids == ["GD01-001", "GD01-001_p1"]


def test_parse_detail_parallel_pilot():
    card = cc.parse_detail("GD05-089_p1", (FIX / "detail_GD05-089_p1.html").read_text(encoding="utf-8"))
    assert card["name"] == "Master Asia"
    assert card["card_no"] == "GD05-089"
    assert card["rarity"] == "LR+"
    assert card["color"] == "red"
    assert card["card_type"] == "pilot"
    assert card["set_code"] == "GD05"
    assert card["set_name"] == "Freedom Ascension"
    assert card["parallel"] == 1
    assert card["level"] == "6" and card["ap"] == "+2"
    assert card["image"] == "GD05-089_p1.webp"


def test_parse_detail_token_takes_product_set():
    card = cc.parse_detail("T-029", (FIX / "detail_T-029.html").read_text(encoding="utf-8"))
    assert card["color"] is None
    assert card["card_type"] == "unit token"
    assert card["set_code"] == "ST13"
    assert card["name"] == "Bit / Funnel"


def test_normalisers():
    assert cc.normalise_rarity("LKR +") == "LKR+"
    assert cc.normalise_type("EX RESOURCE") == "ex resource"
    assert cc.set_code_for("R-001", "Edition Beta") == "R"
    assert cc.PRINT_ID_RE.match("EXRP-020") and not cc.PRINT_ID_RE.match("../etc/passwd")


def test_search(monkeypatch):
    fake = {"cards": [
        {"id": "ST11-003", "card_no": "ST11-003", "name": "Zock", "set_code": "ST11"},
        {"id": "GD01-010", "card_no": "GD01-010", "name": "Zaku II", "set_code": "GD01"},
        {"id": "GD02-050", "card_no": "GD02-050", "name": "Char's Zaku", "set_code": "GD02"},
    ]}
    monkeypatch.setattr(cc, "load_catalog", lambda force=False: fake)
    assert [c["id"] for c in cc.search_cards("zock")] == ["ST11-003"]
    assert [c["id"] for c in cc.search_cards("zaku")] == ["GD01-010", "GD02-050"]
    assert [c["id"] for c in cc.search_cards("st11-003")] == ["ST11-003"]
    assert [c["id"] for c in cc.search_cards("zaku", set_code="GD02")] == ["GD02-050"]


def test_search_type_keywords(monkeypatch):
    fake = {"cards": [
        {"id": "EXB-001", "card_no": "EXB-001", "name": "EX Base", "card_type": "ex base", "set_code": "ST01"},
        {"id": "EXR-001", "card_no": "EXR-001", "name": "EX Resource", "card_type": "ex resource", "set_code": "ST01"},
        {"id": "RP-024", "card_no": "RP-024", "name": "Resource", "card_type": "resource", "set_code": "R"},
        {"id": "T-029", "card_no": "T-029", "name": "Bit / Funnel", "card_type": "unit token", "set_code": "ST13"},
    ]}
    monkeypatch.setattr(cc, "load_catalog", lambda force=False: fake)
    ids = lambda q: [c["id"] for c in cc.search_cards(q)]  # noqa: E731
    assert ids("ex token") == ids("EX Tokens") == ["EXB-001", "EXR-001"]
    assert ids("resource") == ["RP-024"]  # not the EX Resource
    assert ids("unit token") == ["T-029"]
    assert ids("token") == ["EXB-001", "EXR-001", "T-029"]
