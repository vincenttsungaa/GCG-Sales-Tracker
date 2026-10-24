from io import BytesIO

from openpyxl import load_workbook

from lib.export import build_workbook, export_filename


def test_user_text_is_never_a_formula():
    data = build_workbook([{"kind": "card", "name": '=HYPERLINK("x")', "status": "sold"}])
    ws = load_workbook(BytesIO(data))["Listings"]
    assert ws["A3"].value == '=HYPERLINK("x")' and ws["A3"].data_type == "s"
    assert ws["K3"].data_type == "f"  # the app's own totals stay formulas


def test_every_text_column_is_guarded():
    data = build_workbook([{"kind": "item", "name": "x", "part": "=1+1", "edition": "=2+2", "card_quantities": {"=A1": 1}}])
    ws = load_workbook(BytesIO(data))["Listings"]
    formulas = {c.column_letter for c in ws[3] if c.data_type == "f"}
    assert formulas == {"K", "M", "Q", "R"}  # Asking total, Paid total, Sale total, Profit only


def test_sheets_stacks_and_filename():
    items = [
        {"id": "1", "kind": "card", "name": "A", "status": "for_sale", "stack_id": "s1"},
        {"id": "2", "kind": "card", "name": "B", "status": "sold", "stack_id": "s2"},
    ]
    stacks = {"s1": "=EVIL", "s2": "Sale: [GD]/1"}
    wb = load_workbook(BytesIO(build_workbook(items, stacks, "Sales", per_stack=True)))
    assert wb.sheetnames == ["Summary", "Listings", "Sales", "=EVIL", "Sale GD 1"]
    assert wb["Listings"]["G3"].value == "=EVIL" and wb["Listings"]["G3"].data_type == "s"  # stack name stays text
    assert wb["Sales"]["A3"].value == "B" and wb["Sales"]["A4"].value.startswith("Totals")
    assert export_filename("For Sale, with your filters").startswith("cardstakk-for-sale-with-your-filters-")


def test_reserved_sheet_name_is_avoided():
    items = [{"id": "1", "kind": "card", "name": "A", "status": "for_sale", "stack_id": "h"}]
    wb = load_workbook(BytesIO(build_workbook(items, {"h": "History"}, per_stack=True)))
    assert "History" not in wb.sheetnames and "History (2)" in wb.sheetnames
