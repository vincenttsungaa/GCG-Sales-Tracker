"""Read-only check of an account's realized sales, Stakk by Stakk — changes nothing.

Run from backend/ with the venv on:
    python check_sales.py you@example.com                      # every Stakk
    python check_sales.py you@example.com "GD06 AA" LR General # just these Stakks

For each Stakk it lists every sale the way CardStakk adds it up (per-unit deal price × units sold),
then flags the usual reasons a total differs from what reached the bank:
  ASKING  no deal price was saved, so the sale counts at the asking price
  ×QTY    more than one unit in one sale: check the deal price was per unit, not the whole deal
  DUP?    another sale with the same card, buyer, date and price (a double entry?)
Sales whose listing was taken out of a Stakk (or whose Stakk was deleted) are listed at the end,
because they no longer count toward any Stakk.
"""

import asyncio
import sys
from collections import Counter, defaultdict

from lib.auth import norm_email
from lib.db import db


def money(v: float) -> str:
    return f"A${v:,.2f}"


async def main(email: str, wanted: list[str]) -> None:
    user = await db.users.find_one({"email": norm_email(email)}, {"_id": 0, "id": 1})
    if not user:
        sys.exit(f"No account for {email}")
    stacks = {s["id"]: s["name"] async for s in db.stacks.find({"owner_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})}
    sold = [d async for d in db.items.find({"owner_id": user["id"], "status": "sold"}, {"_id": 0})]
    if wanted:
        low = {w.lower() for w in wanted}
        missing = low - {n.lower() for n in stacks.values()}
        if missing:
            print("No Stakk named:", ", ".join(sorted(missing)), "| Stakks:", ", ".join(sorted(stacks.values())))

    dup_key = lambda d: (d.get("name"), d.get("card_no"), d.get("buyer_name"), d.get("deal_date"), d.get("sale_price"), d.get("quantity"))
    dups = Counter(dup_key(d) for d in sold)
    by_stack: dict[str | None, list[dict]] = defaultdict(list)
    for d in sold:
        by_stack[d.get("stack_id") if d.get("stack_id") in stacks else None].append(d)

    grand = 0.0
    for sid, name in sorted(stacks.items(), key=lambda kv: kv[1].lower()):
        if wanted and name.lower() not in {w.lower() for w in wanted}:
            continue
        rows = sorted(by_stack.get(sid, []), key=lambda d: d.get("deal_date") or "")
        total = profit = 0.0
        print(f"\n=== {name} — {len(rows)} sales ===")
        print(f"{'date':<11}{'qty':>4}  {'per unit':>11}  {'total':>11}  {'cost/unit':>10}  flags  card · buyer")
        for d in rows:
            qty = d.get("quantity") or 1
            unit = d.get("sale_price") if d.get("sale_price") is not None else d.get("price") or 0
            line = unit * qty
            total += line
            cost = d.get("purchase_price")
            if cost is not None:
                profit += line - cost * qty
            flags = " ".join(
                f
                for f, on in (("ASKING", d.get("sale_price") is None), ("×QTY", qty > 1), ("DUP?", dups[dup_key(d)] > 1))
                if on
            )
            print(
                f"{(d.get('deal_date') or '—'):<11}{qty:>4}  {money(unit):>11}  {money(line):>11}  "
                f"{(money(cost) if cost is not None else '—'):>10}  {flags:<6} {d.get('name')} {d.get('card_no') or ''} · {d.get('buyer_name') or '—'}"
            )
        grand += total
        print(f"--- {name}: realized {money(total)} · profit after costs {money(profit)} (sales with no cost left out)")

    loose = by_stack.get(None, [])
    if loose and not wanted:
        print(f"\n=== Not in any Stakk — {len(loose)} sales, {money(sum(((d.get('sale_price') if d.get('sale_price') is not None else d.get('price') or 0) * (d.get('quantity') or 1)) for d in loose))} ===")
        for d in sorted(loose, key=lambda d: d.get("deal_date") or ""):
            print(f"  {d.get('deal_date') or '—'}  {d.get('name')} {d.get('card_no') or ''} ×{d.get('quantity') or 1} · {d.get('buyer_name') or '—'}")
    print(f"\nTotal of the Stakks above: {money(grand)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2:]))
