# Gundam Collection Tracker — Spec

Personal Gundam Card Game inventory & sales tracker. Single user, **no auth**.

## What it does
- **Unified inventory** of cards (`kind="card"`) and general items (`kind="item"`) with a sale lifecycle: `for_sale → pending → sold`.
- **Tabs**: All Items (active, non-sold) / For Sale / Pending / **Archive** (= sold items, auto-moved on sale; Restore puts them back to `for_sale` and clears the deal record).
- **Deal record**: buyer name, deal date (YYYY-MM-DD), sale price (AUD, **per unit**). Required by the backend when marking `sold` (422 otherwise); optional when marking `pending`.
- **Profit tracking**: optional `purchase_price` (AUD, per unit) per entry; sold records show total profit `(sale_price − purchase_price) × qty` (green/red, grid + table + archive); Realized Sales stat shows profit after costs.
- **Partial sales**: deal dialog has "Qty to sell" (1..quantity) for multi-qty entries; selling fewer creates a standalone archived sold record and keeps the listing active with reduced qty and cleared deal fields; selling all = whole-entry sale. `quantity_sold` > owned → 422.
- **Photos**: optional `image_url` per entry; grid view renders a thumbnail (hidden if the URL fails to load).
- **Filters** (client-side, instant, combinable): name search, color, type, rarity, buyer name, deal-date from/to. Color pills + type/rarity selects + buyer text + date range in FilterBar.
- **Stats strip**: active entries/units, collection value A$, open deals, realized sales A$.
- **Views**: dense table (default) + card grid toggle. Sonner toasts confirm every mutation.
- **Add/Edit dialog** (`Add Card` / `Add Item` buttons): name, color (card), type (card), rarity (card), category (item), price AUD, qty, condition, notes.

## Taxonomies (validated server-side as Literals → 422 on bad values)
- Colors: `red, white, blue, green, purple`
- Types: `unit, pilot, ex base, ex resource, resource, command, base, unit token`
- Rarities: `C, C+, C++, UC, UC+, R, R+, LR, LR+, LR++, SP, P, LK`
- Item categories: `booster box, playmat, sleeves, deck box, binder, model kit, other`

## Data model — Mongo collection `items` (mirror TS interface in `frontend/src/lib/types.ts`)
`id` (uuid4 str), `kind`, `name`, `color?`, `card_type?`, `rarity?`, `category?`, `price` (AUD float, per unit), `purchase_price?` (AUD, per unit), `image_url?`, `quantity`, `condition?`, `notes?`, `status`, `buyer_name?`, `deal_date?`, `sale_price?` (AUD, per unit), `created_at` (aware UTC), `sold_at?`.
Indexes in `backend/lib/db.py` (id unique, status+created_at, buyer_name, deal_date).

## API (all on api_router, prefix `/api`)
- `GET /items` → list (created_at desc); `POST /items` (201); `PUT /items/{id}` (edit; preserves sale record); `PATCH /items/{id}/status` (lifecycle; sold requires buyer+date; for_sale clears deal); `DELETE /items/{id}` (204); `GET /today` (server-anchored today, APP_TZ=Australia/Sydney).

## Key flows
Add (UI) → appears in All Items → Mark Pending/Sold (deal dialog: buyer, date, price) → sold rows leave active tabs, land in Archive with "Sold to X · date · price" → Restore (clears deal) or Delete.

## Seed
`cd /app/backend && python seed.py` — 20 items (18 active, 2 sold: Nu Gundam→Sarah K., 9-Pocket Binder→Mitch R.), idempotent. No credentials anywhere (no auth).
