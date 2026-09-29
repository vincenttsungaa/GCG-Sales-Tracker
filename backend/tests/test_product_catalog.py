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
    assert pb01["parts"] == pb02["parts"] == ["Sealed", "Storage Box", "Sleeves", "Playmat", "Deck Box", "Resources", "Alt-Art Cards", "Divider"]
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


def test_product_names_lead_with_their_code():
    items = {p["id"]: p for p in _products()}
    assert items["pb01"]["name"] == "[PB01] Premium Accessory Set -Mobile Suit Gundam Wing-"
    assert items["st01"]["name"] == "[ST01] Heroic Beginnings"
    assert items["dice01"]["name"] == "Official Damage Counter Dice 01"  # no code → unchanged
    assert pc.code_first("[PB02] Already first") == "[PB02] Already first"
    assert pc.code_first("Stardust Trails[GD06]") == "[GD06] Stardust Trails"


def test_part_photos_for_pb01_and_pb02():
    for pid in ("pb01", "pb02"):
        urls = pc.part_photo_urls(pid)
        assert set(urls) == {"Storage Box", "Sleeves", "Playmat", "Deck Box", "Divider"}
        assert urls["Storage Box"] == f"/api/product-images/{pid}-part-storage-box.svg?v={pc.PART_PHOTO_VERSION}"
    assert pc.part_photo_urls("st01") == {}
    svg = pc.part_photo_svg(b"webp", (0.1, 0.2, 0.5, 0.6))
    assert 'viewBox="70 140 280 280"' in svg and "data:image/webp;base64," in svg
    assert 'viewBox="0 0 700 700"' in pc.part_photo_svg(b"webp", None)
    # zoom out: 20% white space on each side of a 280×280 crop → 392×392 view
    padded = pc.part_photo_svg(b"webp", (0.1, 0.2, 0.5, 0.6), pad=0.2)
    assert 'viewBox="14 84 392 392"' in padded and 'clip-path="url(#crop)"' in padded
    # whiten: brightening filter only when asked for
    assert 'filter="url(#whiten)"' in pc.part_photo_svg(b"webp", None, whiten=1.07)
    assert "whiten" not in pc.part_photo_svg(b"webp", None)
    # cover: a white box painted over part of the photo (e.g. a caption)
    covered = pc.part_photo_svg(b"\xff\xd8jpg", None, cover=[(0.0, 0.86, 1.0, 1.0)])
    assert '<rect x="0" y="602" width="700" height="98" fill="#FFFFFF"/>' in covered
    assert "data:image/jpeg;base64," in covered
    assert pc.ensure_part_photo("pb01", "resources") is None  # no photo for card parts


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


def test_outside_covers_everything_but_the_item():
    strips = pc.outside((0.1, 0.2, 0.8, 0.9))
    assert strips == [(0.0, 0.0, 1.0, 0.2), (0.0, 0.9, 1.0, 1.0), (0.0, 0.2, 0.1, 0.9), (0.8, 0.2, 1.0, 0.9)]
    # every PB01/PB02 sleeves and playmat photo paints its backdrop white
    for pid in ("pb01", "pb02"):
        for part in ("Sleeves", "Playmat"):
            extras = pc.PART_PHOTOS[pid][part][2]
            assert len(extras["cover"]) == 4


def test_sleeve01_designs():
    designs = pc.sleeve_designs("sleeve01")
    assert [d["name"] for d in designs] == [
        "GUNDAM CARD GAME Logo",
        "Overflowing Affection",
        "Gundam/EFSF",
        "Char's Zaku Ⅱ/Zeon",
    ]
    assert designs[2]["image_url"] == "/api/product-images/sleeve01-sleeves.svg?designs=efsf"
    assert pc.sleeve_designs("pb01") == []  # only sleeve products with designs get the picker


def test_sleeve_set_svg_one_design_is_just_that_sleeve():
    svg = pc.sleeve_set_svg([(b"webp", (0.196, 0.516, 0.483, 0.91), True)])
    assert 'viewBox="137.2 361.2 200.9 275.8"' in svg
    assert "#0B0F17" not in svg  # no mosaic background


def test_sleeve_set_svg_mosaic_matches_resource_layout():
    cell = (b"webp", (0.196, 0.09, 0.483, 0.484), True)
    two = pc.sleeve_set_svg([cell, cell])
    assert 'viewBox="0 0 284 200"' in two and 'fill="#0B0F17"' in two  # 2 → 2×1, dark background
    assert two.count("<image ") == 1  # the shared photo is embedded once
    three = pc.sleeve_set_svg([cell, cell, cell])
    assert 'viewBox="0 0 284 384"' in three  # 3 → 2×2
    assert '<svg x="79" y="196"' in three  # short last row centred
    assert three.count('preserveAspectRatio="xMidYMid slice"') == 3


def test_set_contents_mix_photos_and_cards():
    picks = {d["id"]: d for d in pc.sleeve_designs("evx07")}
    assert pc.sleeve_label("evx07") == "Set contents" and pc.sleeve_label("sleeve02") == "Sleeve designs"
    assert picks["storage-box"]["fit"] == "contain"  # a box is fitted, not cropped to card shape
    assert picks["rp-045"] == {
        "id": "rp-045", "name": "RP-045", "image_url": "/api/card-images/RP-045.webp", "fit": "cover"
    }
    assert [d["name"] for d in pc.sleeve_designs("evx06")] == ["Zeon", "ZAFT", "Celestial Being", "Mafty"]
    assert len(pc.sleeve_designs("goodsset01")) == 12  # storage box, playmat, RP-011 … RP-020
    sc01 = [d["name"] for d in pc.sleeve_designs("deck-build-box")]
    assert "EXB-001" in sc01 and "Storage Box (Design 3)" in sc01
    # a box among cards is fitted inside its cell ("meet"), the card fills its cell ("slice")
    svg = pc.sleeve_set_svg([(b"box", (0.1, 0.3, 0.9, 0.8), False), (b"card", None, True)])
    assert 'preserveAspectRatio="xMidYMid meet"' in svg and 'preserveAspectRatio="xMidYMid slice"' in svg
    assert 'width="630" height="880"' in svg  # the card image is placed in card ratio


def test_card_case_playmat_and_dice_sets():
    names = {pid: [d["name"] for d in pc.sleeve_designs(pid)] for pid in ("deck-case01", "deck-case02", "playmat01", "evx11", "dice01")}
    assert names["deck-case01"] == ["Deck Case", "Separator", "EXRP-002", "EXBP-002"]
    assert names["deck-case02"] == ["Deck Case", "Separator", "GD01-023", "GD01-030"]
    assert names["playmat01"] == ["Playmat", "EXRP-015"] and names["evx11"] == ["Playmat", "EXRP-019"]
    assert names["dice01"] == ["Dice (x6)", "Dice Case"]
    fits = {d["id"]: d["fit"] for d in pc.sleeve_designs("deck-case02")}
    # the red deck case is nearly card-shaped but is still fitted whole, not cropped to fill
    assert fits == {"deck-case": "contain", "separator": "contain", "gd01-023_p2": "cover", "gd01-030_p3": "cover"}
    assert {d["fit"] for d in pc.sleeve_designs("sleeve02")} == {"cover"}


def test_mosaic_cells_are_clipped_to_their_crop():
    svg = pc.sleeve_set_svg([(b"mat", (0.1, 0.1, 0.9, 0.5), False), (b"card", None, True)])
    assert '<clipPath id="cell0"><rect x="70" y="70" width="560" height="280"/></clipPath>' in svg
    assert 'clip-path="url(#cell1)"' in svg


def test_pb03_first_anniversary_set():
    opts = pc.product_options("pb03")
    assert opts["parts"] == [
        "Storage Box", "Sleeves (Blue)", "Sleeves (Green)", "Playmat", "Card Case",
        "Damage Counter Dice", "Resources", "Alt-Art Cards",
    ]
    assert opts["resource_cards"] == ["RP-068", "RP-068_p1"]
    assert len(opts["alt_art_cards"]) == 12 and opts["alt_art_cards"][-2:] == ["EXRP-017", "EXBP-035"]
    # every physical part has a photo; the card parts use the card images instead
    assert set(pc.part_photo_urls("pb03")) == {
        "Storage Box", "Sleeves (Blue)", "Sleeves (Green)", "Playmat", "Card Case", "Damage Counter Dice",
    }
    assert pc.part_photo_urls("pb03")["Sleeves (Blue)"].startswith("/api/product-images/pb03-part-sleeves-blue.svg")


def test_premium_card_collection_assemble_sets_and_edition_beta():
    pc01a = pc.product_options("pc01a")
    assert pc01a["parts"] == [
        "ASSEMBLE: Gundam Barbatos 4th Form", "ASSEMBLE: Graze Custom", "ASSEMBLE: CGS Mobile Worker",
        "Alt-Art Cards", "Resources",
    ]
    assert pc01a["resource_cards"] == [f"EXRP-00{n}" for n in range(4, 9)]
    assert len(pc01a["alt_art_cards"]) == 7 and "T-017_p1" in pc01a["alt_art_cards"]
    assert pc.product_options("pc02a")["resource_cards"] == ["EXRP-009", "EXRP-010", "EXRP-011", "EXRP-012", "EXRP-013"]
    # each ASSEMBLE kit has its own photo
    assert pc.part_photo_urls("pc02a")["ASSEMBLE: GQuuuuuuX (Omega Psycommu)"].startswith(
        "/api/product-images/pc02a-part-assemble-gquuuuuux-omega-psycommu.svg"
    )
    beta = pc.product_options("limitedbox-beta")
    assert beta["parts"] == ["Storage Box", "Booster Pack", "Damage Counter Dice", "Resources", "Alt-Art Cards"]
    assert beta["resource_cards"] == ["R-001_p4", "R-001_p5", "EXR-001_p5"]
    assert len(beta["alt_art_cards"]) == 80
    assert set(pc.part_photo_urls("limitedbox-beta")) == {"Storage Box", "Booster Pack", "Damage Counter Dice"}
    # the six-card Premium Card Collections use the set-contents picker
    assert [d["name"] for d in pc.sleeve_designs("evx05")] == [
        "ST01-001", "ST03-008", "ST05-002", "ST06-002", "GD01-068", "GD01-086",
    ]
    assert len(pc.sleeve_designs("evx13")) == 6 and pc.sleeve_label("evx13") == "Set contents"


def test_bundle_cells_leave_out_painted_over_areas():
    # a caption strip painted white at the bottom is cropped off
    assert pc._part_crop(None, {"cover": [(0.0, 0.86, 1.0, 1.0)]}) == (0.0, 0.0, 1.0, 0.86)
    # a backdrop painted white around the item (outside(box)) leaves just the item
    box = (0.073, 0.169, 0.329, 0.52)
    assert pc._part_crop((0.06, 0.15, 0.35, 0.55), {"cover": pc.outside(box)}) == box
    # a plain crop is kept as it is
    assert pc._part_crop((0.1, 0.2, 0.3, 0.4), {"pad": 0.3}) == (0.1, 0.2, 0.3, 0.4)
    # nothing valid picked → no picture
    assert pc.ensure_bundle_image("pb01", ["no-such-part"], ["RP-999"]) is None
