"""Listings → an editable Excel workbook (.xlsx), and sending it by email.

The workbook is plain .xlsx (Office Open XML), so it opens and edits in Microsoft Excel,
Google Sheets, LibreOffice / OpenOffice, Apple Numbers and the Excel / Sheets phone apps.
Values are real numbers and dates (not text), totals and the Summary sheet are formulas,
so editing a price or a quantity updates them.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from io import BytesIO

import re

from lib.email_design import add_html, file_box, quote, render, rows

logger = logging.getLogger(__name__)
from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
AUD = '"A$"#,##0.00;[Red]-"A$"#,##0.00'
STATUS_LABELS = {"for_sale": "For Sale", "pending": "Pending", "on_hold": "Storage", "sold": "Sold"}
# status tag colours (fill, text) — conditional formatting, so they follow edits
STATUS_COLOURS = {"For Sale": ("DBEAFE", "1E40AF"), "Pending": ("FEF3C7", "92400E"), "Storage": ("EDE9FE", "5B21B6"), "Sold": ("D1FAE5", "065F46")}

# The Listings sheet: (group, colour) bands over (header, width) columns.
GROUPS = [
    ("Listing", "3B4A6B", [("Name", 40), ("Code", 12), ("Type", 8), ("Category / card type", 20), ("Rarity", 8), ("Colour", 9)]),
    ("Stock", "5B4B8A", [("Stack", 22), ("Status", 11), ("Qty", 6), ("Asking (each)", 13), ("Asking total", 13), ("Paid (each)", 12), ("Paid total", 12)]),
    ("Deal", "2F6F5E", [("Buyer", 18), ("Deal date", 12), ("Sold for (each)", 14), ("Sale total", 13), ("Profit", 12)]),
    ("More", "6B7280", [("Notes", 34), ("Edition", 14), ("Part", 20), ("Contents", 34), ("Condition", 12), ("Added", 12)]),
]
COLUMNS = [c for _, _, cols in GROUPS for c in cols]
COL = {name: get_column_letter(i + 1) for i, (name, _) in enumerate(COLUMNS)}
OWN_FORMULAS = {COL[n] for n in ("Asking total", "Paid total", "Sale total", "Profit")}
MONEY = ["Asking (each)", "Asking total", "Paid (each)", "Paid total", "Sold for (each)", "Sale total", "Profit"]
HEAD_ROW, FIRST = 2, 3  # row 1: group bands, row 2: headers, data from row 3
WHITE_BOLD = Font(bold=True, color="FFFFFF")


def _title(value: str | None) -> str:
    return (value or "").replace("_", " ").title()


def _contents(item: dict) -> str:
    """What's inside a listing: the products in a bundle, or the cards / designs picked."""
    bundle = item.get("bundle_items") or []
    if len(bundle) > 1:
        parts = []
        for e in bundle:
            label = e.get("code") or e.get("name") or "Item"
            qty = e.get("quantity") or 1
            parts.append(f"{label} ({qty}x)" + (f" — {e['detail']}" if e.get("detail") else ""))
        return "; ".join(parts)
    copies = item.get("card_quantities") or {}
    if copies:
        return ", ".join(f"{k} ({v}x)" for k, v in copies.items())
    picked = [*(item.get("resource_cards") or []), *(item.get("alt_art_cards") or []), *(item.get("sleeve_designs") or [])]
    return ", ".join(picked)


def _date(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def _guard(row) -> None:
    """Typed text starting with "=" stays text; only the app's own totals are formulas."""
    for cell in row:
        if cell.column_letter not in OWN_FORMULAS and isinstance(cell.value, str) and cell.value.startswith("="):
            cell.data_type = "s"


def _write_listings(ws, items: list[dict], stacks: dict[str, str], table_name: str) -> int:
    """Banded headers, one row per listing, totals row (respects filters). Returns the last data row."""
    col = 1
    for group, colour, cols in GROUPS:
        first, last_col = get_column_letter(col), get_column_letter(col + len(cols) - 1)
        ws.merge_cells(f"{first}1:{last_col}1")
        ws[f"{first}1"] = group
        for c in range(col, col + len(cols)):
            ws.cell(row=1, column=c).fill = PatternFill("solid", fgColor=colour)
        ws[f"{first}1"].font = WHITE_BOLD
        col += len(cols)
    for i, (name, width) in enumerate(COLUMNS, start=1):
        ws.cell(row=HEAD_ROW, column=i, value=name)
        ws.column_dimensions[get_column_letter(i)].width = width

    for row, item in enumerate(items, start=FIRST):
        is_card = item.get("kind") == "card"
        r = str(row)
        values = {
            "Name": item.get("name"),
            "Code": item.get("card_no") or item.get("set_code"),
            "Type": "Card" if is_card else "Item",
            "Category / card type": _title(item.get("card_type") if is_card else item.get("category")),
            "Rarity": item.get("rarity"),
            "Colour": _title(item.get("color")),
            "Stack": stacks.get(item.get("stack_id") or "", None),
            "Status": STATUS_LABELS.get(item.get("status"), _title(item.get("status"))),
            "Qty": item.get("quantity") or 1,
            "Asking (each)": item.get("price") or 0,
            "Asking total": f"={COL['Qty']}{r}*{COL['Asking (each)']}{r}",
            "Paid (each)": item.get("purchase_price"),
            "Paid total": f'=IF({COL["Paid (each)"]}{r}="","",{COL["Qty"]}{r}*{COL["Paid (each)"]}{r})',
            "Buyer": item.get("buyer_name"),
            "Deal date": _date(item.get("deal_date")),
            "Sold for (each)": item.get("sale_price"),
            # sold without a sale price: it went at the asking price (as in the app)
            "Sale total": f'=IF({COL["Status"]}{r}<>"Sold","",{COL["Qty"]}{r}*IF({COL["Sold for (each)"]}{r}="",{COL["Asking (each)"]}{r},{COL["Sold for (each)"]}{r}))',
            "Profit": f'=IF(OR({COL["Status"]}{r}<>"Sold",{COL["Paid (each)"]}{r}=""),"",{COL["Sale total"]}{r}-{COL["Paid total"]}{r})',
            "Notes": item.get("notes"),
            "Edition": item.get("edition"),
            "Part": item.get("part"),
            "Contents": _contents(item),
            "Condition": item.get("condition"),
            "Added": _date(item.get("created_at")),
        }
        for i, (name, _) in enumerate(COLUMNS, start=1):
            ws.cell(row=row, column=i, value=values[name])
        _guard(ws[row])

    last = max(FIRST + len(items) - 1, FIRST)
    for name in MONEY:
        for (cell,) in ws[f"{COL[name]}{FIRST}:{COL[name]}{last + 1}"]:
            cell.number_format = AUD
    for name in ("Deal date", "Added"):
        for (cell,) in ws[f"{COL[name]}{FIRST}:{COL[name]}{last}"]:
            cell.number_format = "dd/mm/yyyy"
    for name in ("Name", "Contents", "Notes"):
        for (cell,) in ws[f"{COL[name]}{FIRST}:{COL[name]}{last}"]:
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    status_rng = f"{COL['Status']}{FIRST}:{COL['Status']}{last}"
    for label, (fill, text) in STATUS_COLOURS.items():
        ws.conditional_formatting.add(
            status_rng,
            FormulaRule(formula=[f'${COL["Status"]}{FIRST}="{label}"'], fill=PatternFill("solid", fgColor=fill), font=Font(bold=True, color=text)),
        )

    if items:  # a real Excel table: filters / sorting, banded rows
        table = Table(displayName=table_name, ref=f"A{HEAD_ROW}:{get_column_letter(len(COLUMNS))}{last}")
        table.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
        ws.add_table(table)
    for cell in ws[HEAD_ROW]:
        cell.font = Font(bold=True)

    # totals row under the table — SUBTOTAL, so it follows the filters
    t = last + 1
    ws[f"A{t}"] = f"Totals · {len(items)} {'listing' if len(items) == 1 else 'listings'}"
    for name in ("Qty", "Asking total", "Paid total", "Sale total", "Profit"):
        ws[f"{COL[name]}{t}"] = f"=SUBTOTAL(109,{COL[name]}{FIRST}:{COL[name]}{last})"
    top = Side(style="medium", color="94A3B8")
    for c in range(1, len(COLUMNS) + 1):
        cell = ws.cell(row=t, column=c)
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="F1F5F9")
        cell.border = Border(top=top)
    ws.freeze_panes = f"B{FIRST}"
    return last


def _exact(text: str) -> str:
    """A COUNTIF/SUMIF criterion matching exactly this text: "=" in front (so < > = aren't comparisons)
    and ~ * ? escaped (so they aren't wildcards)."""
    escaped = text.replace("~", "~~").replace("*", "~*").replace("?", "~?").replace('"', '""')
    return f'"={escaped}"'


def _sheet_name(name: str, taken: set[str]) -> str:
    base = " ".join(re.sub(r"[\\/*?:\[\]]", " ", name).split())[:31].strip("'") or "Stack"  # Excel: no leading / trailing apostrophe
    out, n = base, 2
    while out.casefold() in taken:
        suffix = f" ({n})"
        out, n = base[: 31 - len(suffix)] + suffix, n + 1
    taken.add(out.casefold())
    return out


def build_workbook(
    items: list[dict],
    stacks: dict[str, str] | None = None,
    label: str | None = None,
    per_stack: bool = False,
    full: bool = True,
) -> bytes:
    """Summary sheet (formulas), Listings (all), Sales (sold only), and optionally a sheet per stack.
    full=False (Free plan): just the Listings sheet — every listing, sold ones included."""
    stacks = stacks or {}
    wb = Workbook()
    if not full:
        wb.active.title = "Listings"
        _write_listings(wb.active, items, stacks, "Listings")
        out = BytesIO()
        wb.save(out)
        return out.getvalue()
    s = wb.active
    s.title = "Summary"
    ws = wb.create_sheet("Listings")
    last = _write_listings(ws, items, stacks, "Listings")
    rng = lambda name: f"Listings!${COL[name]}${FIRST}:${COL[name]}${last}"  # noqa: E731

    # ---- Summary ----
    for c, w in zip("ABCDEF", (30, 14, 14, 16, 16, 16)):
        s.column_dimensions[c].width = w
    s["A1"] = "CardStakk · Inventory & sales"
    s["A1"].font = Font(bold=True, size=16)
    count = len(items)
    s["A2"] = f"Exported {datetime.now().strftime('%d %b %Y, %H:%M')} · {label or 'All listings'} · {count} {'listing' if count == 1 else 'listings'}"
    s["A2"].font = Font(color="6B7280")
    tiles = [
        ("Asking value", f'=SUMIF({rng("Status")},"<>Sold",{rng("Asking total")})', "111827"),
        ("Paid for stock", f'=SUMIF({rng("Status")},"<>Sold",{rng("Paid total")})', "111827"),
        ("Realized sales", f"=SUM({rng('Sale total')})", "047857"),
        ("Profit after costs", f"=SUM({rng('Profit')})", "047857"),
    ]
    thin = Side(style="thin", color="E5E7EB")
    for (title, formula, colour), c in zip(tiles, "ABCD"):
        s[f"{c}4"] = title.upper()
        s[f"{c}4"].font = Font(size=9, color="6B7280", bold=True)
        s[f"{c}5"] = formula
        s[f"{c}5"].font = Font(size=15, bold=True, color=colour)
        s[f"{c}5"].number_format = AUD
        for r in (4, 5):
            s[f"{c}{r}"].border = Border(left=thin, right=thin, top=thin if r == 4 else None, bottom=thin if r == 5 else None)

    def band(row: int, headers: list[str], colour: str) -> None:
        for c, h in zip("ABCDEF", headers):
            s[f"{c}{row}"] = h
            s[f"{c}{row}"].font = WHITE_BOLD
            s[f"{c}{row}"].fill = PatternFill("solid", fgColor=colour)
            if c != "A":
                s[f"{c}{row}"].alignment = Alignment(horizontal="right")

    def total_row(row: int, first: int, cols: str) -> None:
        s[f"A{row}"] = "Total"
        for c in cols:
            s[f"{c}{row}"] = f"=SUM({c}{first}:{c}{row - 1})"
        for c in "ABCDEF":
            s[f"{c}{row}"].font = Font(bold=True)
            s[f"{c}{row}"].fill = PatternFill("solid", fgColor="F1F5F9")
            s[f"{c}{row}"].border = Border(top=Side(style="medium", color="94A3B8"))

    band(7, ["By status", "Listings", "Units", "Asking", "Paid", "Realized"], "3B4A6B")
    row = 8
    for label_ in ("For Sale", "Pending", "Storage", "Sold"):
        crit = f'{rng("Status")},"{label_}"'
        s[f"A{row}"] = label_
        fill, text = STATUS_COLOURS[label_]
        s[f"A{row}"].font = Font(bold=True, color=text)
        s[f"A{row}"].fill = PatternFill("solid", fgColor=fill)
        s[f"B{row}"] = f"=COUNTIF({crit})"
        s[f"C{row}"] = f"=SUMIF({crit},{rng('Qty')})"
        s[f"D{row}"] = f"=SUMIF({crit},{rng('Asking total')})"
        s[f"E{row}"] = f"=SUMIF({crit},{rng('Paid total')})"
        s[f"F{row}"] = f"=SUMIF({crit},{rng('Sale total')})"
        row += 1
    total_row(row, 8, "BCDEF")
    for r in range(8, row + 1):
        for c in "DEF":
            s[f"{c}{r}"].number_format = AUD

    # by stack: every stack these listings are in, then the ones in no stack
    names = sorted({stacks[i["stack_id"]] for i in items if i.get("stack_id") in stacks}, key=str.casefold)
    loose = any(i.get("stack_id") not in stacks for i in items)
    row += 2
    band(row, ["By stack", "Listings", "Units", "Asking", "Realized", "Profit"], "5B4B8A")
    first = row + 1
    for name in [*names, *([None] if loose else [])]:
        row += 1
        crit = f'{rng("Stack")},{_exact(name)}' if name else f'{rng("Stack")},""'
        s[f"A{row}"] = name or "Not in a stack"
        if not name:
            s[f"A{row}"].font = Font(italic=True, color="6B7280")
        s[f"B{row}"] = f"=COUNTIF({crit})"
        s[f"C{row}"] = f"=SUMIF({crit},{rng('Qty')})"
        s[f"D{row}"] = f'=SUMIFS({rng("Asking total")},{crit},{rng("Status")},"<>Sold")'
        s[f"E{row}"] = f"=SUMIF({crit},{rng('Sale total')})"
        s[f"F{row}"] = f"=SUMIF({crit},{rng('Profit')})"
    row += 1
    total_row(row, first, "BCDEF")
    for r in range(first, row + 1):
        for c in "DEF":
            s[f"{c}{r}"].number_format = AUD
    for r in range(8, row + 1):  # user-typed stack names stay text
        if isinstance(s[f"A{r}"].value, str) and s[f"A{r}"].value.startswith("="):
            s[f"A{r}"].data_type = "s"

    # ---- Sales: sold records only, newest deal first ----
    sold = sorted((i for i in items if i.get("status") == "sold"), key=lambda i: str(i.get("deal_date") or ""), reverse=True)
    _write_listings(wb.create_sheet("Sales"), sold, stacks, "Sales")

    # ---- optional: a sheet per stack ----
    if per_stack:
        taken = {"summary", "listings", "sales", "history"}  # "History" is reserved by Excel
        for n, (stack_id, name) in enumerate(stacks.items(), start=1):
            in_stack = [i for i in items if i.get("stack_id") == stack_id]
            if in_stack:
                _write_listings(wb.create_sheet(_sheet_name(name, taken)), in_stack, stacks, f"Stack{n}")

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def export_filename(label: str | None = None) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (label or "listings").lower()).strip("-")[:40] or "listings"
    return f"cardstakk-{slug}-{datetime.now().strftime('%Y-%m-%d')}.xlsx"


class EmailNotConfigured(RuntimeError):
    pass


def send_workbook(
    to: str, data: bytes, filename: str, count: int, note: str | None = None, sender_name: str | None = None, reply_to: str | None = None
) -> None:
    """Email the workbook through the SMTP server set in backend/.env (SMTP_HOST, SMTP_PORT,
    SMTP_USER, SMTP_PASSWORD, SMTP_FROM; SMTP_SSL=true for port 465)."""
    host = os.environ.get("SMTP_HOST")
    if not host:
        raise EmailNotConfigured("Email isn't set up yet: add the SMTP settings to backend/.env.")
    port = int(os.environ.get("SMTP_PORT") or "587")
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("SMTP_FROM") or user or "cardstakk@localhost"

    msg = EmailMessage()
    msg["Subject"] = f"CardStakk listings — {count} {'listing' if count == 1 else 'listings'}"
    msg["From"] = sender
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to  # hitting Reply answers the person who sent it
    body = [
        f"Attached: {filename} ({count} {'listing' if count == 1 else 'listings'}).",
        "It opens in Excel, Google Sheets, LibreOffice, Numbers and the Excel / Sheets phone apps.",
    ]
    if note:
        body = [note.strip(), "", *body]
    msg.set_content("\n".join(body) + "\n\n— Sent from CardStakk")
    listings = f"{count} {'listing' if count == 1 else 'listings'}"
    add_html(
        msg,
        render(
            eyebrow="Spreadsheet attached",
            title=f"{sender_name} sent you a spreadsheet" if sender_name else "A spreadsheet from CardStakk",
            body=[
                *([quote(note.strip())] if note and note.strip() else []),
                file_box(filename, "Opens in Excel, Google Sheets, Numbers and the phone apps"),
                rows([("Listings", listings)]),
            ],
            why=f"Sent from CardStakk by {reply_to}. Reply to answer them directly." if reply_to else "Sent from CardStakk.",
        ),
    )
    msg.add_attachment(data, maintype="application", subtype=XLSX_MIME.split("/", 1)[1], filename=filename)
    from lib.auth import _NO_MAIL

    if to.lower().endswith(_NO_MAIL):  # test address: log instead of sending, like the account emails
        logger.warning("EMAIL (test address, not sent) to %s — %s (%s)", to, msg["Subject"], filename)
        return

    if os.environ.get("SMTP_SSL", "").lower() in ("1", "true", "yes") or port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            if user:
                smtp.login(user, password or "")
            smtp.send_message(msg)
