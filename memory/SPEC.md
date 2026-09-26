# Gundam Collection Tracker — Spec

Personal Gundam Card Game inventory & sales tracker. Single user, **no auth**.

## What it does
- **Unified inventory** of cards (`kind="card"`) and general items (`kind="item"`) with a sale lifecycle: `for_sale → pending → sold`.
- **Tabs**: All Items (active, non-sold) / For Sale / Pending / **Sold** (= sold items, auto-moved on sale; Restore puts them back to `for_sale` and clears the deal record). The Sold tab's internal id is still `archive` (`TabId` in `frontend/src/lib/types.ts`).
- **Deal record**: buyer name, deal date (YYYY-MM-DD), sale price (AUD, **per unit**). Required by the backend when marking `sold` (422 otherwise); optional when marking `pending`.
- **Profit tracking**: optional `purchase_price` (AUD, per unit) per entry; sold records show total profit `(sale_price − purchase_price) × qty` (green/red, grid + table + Sold tab); Realized Sales stat shows profit after costs.
- **Partial sales**: deal dialog has "Qty to sell" (1..quantity) for multi-qty entries; selling fewer creates a standalone sold record (shown on the Sold tab) and keeps the listing active with reduced qty and cleared deal fields; selling all = whole-entry sale. `quantity_sold` > owned → 422.
- **Photos**: optional `image_url` per entry; grid view renders a thumbnail (hidden if the URL fails to load).
- **Filters** (client-side, instant, combinable): name search, color, type, rarity, buyer name, deal-date from/to. Color pills + type/rarity selects + buyer text + date range in FilterBar. Filter state/helpers live in `frontend/src/lib/filters.ts`. The **Buyer** filter only shows on the Pending and Sold tabs; switching to any other tab clears it.
- **Stats strip** (`StatsStrip.tsx`): Collection Value A$ (active items at list price), Realized Sales A$ (profit after costs · sold count), Cards & Items (total QTY of active entries, split into cards · items). Sold entries are excluded from Cards & Items.
- **Views**: tile grid (default; `ItemCard.tsx`) + responsive list toggle (`ItemTable.tsx`). The list renders a dense table at ≥1024px and stacked touch-friendly rows below that (2 columns from 768px), switching via `lib/useMediaQuery.ts` so only one layout is mounted (test ids stay unique). Both layouts show every field: photo, name, condition, notes, kind, color, type/category, rarity, price (sold total + list/unit + profit), qty, status, buyer + deal date, and all actions. Sonner toasts confirm every mutation.
- **Pagination** (`components/Pagination.tsx`, client-side): 10 entries per page (`PAGE_SIZE` in `Dashboard.tsx`) in both table and grid views, with Prev/Next and page numbers ("Showing 11–20 of 23"). Controls only appear when there is more than one page. Resets to page 1 when the tab or filters change; steps back a page if the last page empties. Tab counts and the stats strip still count every entry, not just the current page.
- **Card database** (`backend/lib/card_catalog.py`, `routers/cards.py`, `scrape_cards.py`): scrapes https://www.gundam-gcg.com/en/cards/ — every package from GD01 to Promotion card, including parallel `_pN` printings — into `backend/data/cards.json` (id, card_no, name, color, card_type, rarity, set_code, set_name, product, level/cost/ap/hp/trait) and `backend/data/card_images/<id>.webp` (gitignored). Refresh with `python scrape_cards.py` or POST `/api/cards/sync` (the "Update" link in Add Card). Site rarities are normalised (`LR +` → `LR+`), types lowercased (`UNIT・TOKEN` → `unit token`), color `-` → null. Tokens/resources/EX cards take their set code from the product they come in (`[ST13]`).
- **Add Card** (`AddCardDialog.tsx`): search the card database by name or number → pick the printing → enter asking price, purchase price, qty, notes (no condition) → added as For Sale with name/color/type/rarity/set/card_no/image copied from the catalog (`card_id` links back). "Enter the card manually" falls back to the old free-form form. Editing a catalog card only edits price/qty/condition/notes.
- **Tile grid** (default view, `ItemCard.tsx`): card-list style tiles — rarity chip + card number header, card image (63:88), name, then color · type · set, asking/sold price, paid, profit, qty, deal, notes, actions.
- **Product database** (`backend/lib/product_catalog.py`, `routers/products.py`): scrapes https://www.gundam-gcg.com/en/products/list.php?page=N (all pages, every category **except BOOSTER PACK**) into `backend/data/products.json` (id = page slug e.g. `pb01`, name, code e.g. `PB01`, category, release_date, msrp, url) and `backend/data/product_images/<id>.webp` (gitignored). Refresh with `python scrape_cards.py --products-only` or POST `/api/products/sync` ("Update database" in Add Item). Untagged products count as `other`.
- **Add Item** (`AddItemDialog.tsx`): search the product database (name/code, category chips) → pick → asking price, purchase price, qty, notes → added as For Sale with name/category/code (`set_code`)/image copied (`product_id` links back). "Enter the item manually" falls back to the free-form form. Both catalog dialogs share `CatalogSync.tsx` for the download/update control.
- **Manual Add/Edit dialog** (`ItemFormDialog.tsx`, the "enter manually" fallback + Edit): name, color/type/rarity (card), category (item), price AUD, purchase price, qty, notes, photo URL. **Condition is not asked when adding** — it only appears when editing an existing entry.

## Taxonomies (validated server-side as Literals → 422 on bad values)
- Colors: `red, white, blue, green, purple`
- Types: `unit, pilot, ex base, ex resource, resource, command, base, unit token`
- Rarities: `C, C+, C++, U, U+, R, R+, LR, LR+, LR++, P, P+, LKC+, LKU+, LKR+, SP, LK` (UC/UC+ removed)
- Item categories: `starter deck, accessories, premium bandai, other` (the product list's categories minus booster pack). Older values are mapped on read in `normalise_doc`: playmat/sleeves/deck box/binder → accessories, booster box/model kit → other.

## Data model — Mongo collection `items` (mirror TS interface in `frontend/src/lib/types.ts`)
`id` (uuid4 str), `kind`, `name`, `color?`, `card_type?`, `rarity?`, `category?`, `price` (AUD float, per unit), `purchase_price?` (AUD, per unit), `image_url?`, `card_id?`/`card_no?`/`set_code?`/`set_name?` (card database link), `product_id?` (product database link), `quantity`, `condition?`, `notes?`, `status`, `buyer_name?`, `deal_date?`, `sale_price?` (AUD, per unit), `created_at` (aware UTC), `sold_at?`.
Indexes in `backend/lib/db.py` (id unique, status+created_at, buyer_name, deal_date).

## API (all on api_router, prefix `/api`)
- `GET /items` → list (created_at desc); `POST /items` (201); `PUT /items/{id}` (edit; preserves sale record); `PATCH /items/{id}/status` (lifecycle; sold requires buyer+date; for_sale clears deal); `DELETE /items/{id}` (204); `GET /today` (server-anchored today; set `APP_TZ=Australia/Sydney` in `backend/.env`, otherwise it defaults to UTC); `GET /` (health check).

## Key flows
Add (UI) → appears in All Items → Mark Pending/Sold (deal dialog: buyer, date, price) → sold rows leave active tabs, land in the Sold tab with "Sold to X · date · price" → Restore (clears deal) or Delete.

## Seed
`cd backend && python seed.py` — 20 items (18 active, 2 sold: Nu Gundam→Sarah K., 9-Pocket Binder→Mitch R.), idempotent. No credentials anywhere (no auth).
