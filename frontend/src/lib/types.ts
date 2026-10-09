// Hand-written mirrors of the backend Pydantic models (backend/models/item.py) —
// nothing infers across the HTTP boundary, keep both sides in sync in one edit.

export type ItemKind = "card" | "item";
export type ItemStatus = "for_sale" | "pending" | "on_hold" | "sold"; // on_hold = Storage

export const GUNDAM_COLORS = ["red", "white", "blue", "green", "purple"] as const;
export type GundamColor = (typeof GUNDAM_COLORS)[number];

export const CARD_TYPES = [
  "unit",
  "pilot",
  "ex base",
  "ex resource",
  "resource",
  "command",
  "base",
  "unit token",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

// Official site rarities first (U, U+, P+, LKC+/LKR+/LKU+), then the older labels SP and LK.
export const RARITIES = [
  "C",
  "C+",
  "C++",
  "U",
  "U+",
  "R",
  "R+",
  "LR",
  "LR+",
  "LR++",
  "P",
  "P+",
  "LKC+",
  "LKU+",
  "LKR+",
  "SP",
  "LK",
] as const;
export type Rarity = (typeof RARITIES)[number];

// Follows the official product list categories (booster packs aren't tracked as items).
export const ITEM_CATEGORIES = ["starter deck", "accessories", "premium bandai", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

// Mirror of CollectionItem
export interface CollectionItem {
  id: string;
  kind: ItemKind;
  name: string;
  color: GundamColor | null;
  card_type: CardType | null;
  rarity: Rarity | null;
  category: ItemCategory | null;
  card_id: string | null;
  card_no: string | null;
  set_code: string | null;
  set_name: string | null;
  product_id: string | null;
  edition: string | null; // e.g. "Regular Version" / "Special Edition"
  part: string | null; // piece of a set being sold, e.g. "Playmat" (PB01, PB02)
  resource_cards: string[]; // e.g. ["RP-025", "RP-027"] when part = "Resources"
  alt_art_cards: string[]; // e.g. ["ST02-010_p4"] when part = "Alt-Art Cards" (PB01)
  sleeve_designs: string[]; // e.g. ["Gundam/EFSF"] (Official Card Sleeves 01)
  card_quantities: Record<string, number>; // copies per picked card / sleeve design, e.g. { "GD02-110_p3": 2 }; quantity = total
  card_prices: Record<string, number>; // optional price per copy of a picked card / design; set → one lot, price = its total
  part_prices: Record<string, number>; // optional price of each physical part in a part bundle, e.g. { "Storage Box": 25 }
  bundle_items: BundleEntry[]; // several products listed together (e.g. ST09 + ST01), each optionally priced
  price: number;
  purchase_price: number | null;
  image_url: string | null;
  quantity: number;
  condition: string | null;
  notes: string | null;
  status: ItemStatus;
  buyer_name: string | null;
  deal_date: string | null;
  sale_price: number | null;
  created_at: string;
  sold_at: string | null;
  split_from?: string | null; // sold record split off a listing by a partial sale (restoring merges it back)
}

// One product in a bundle listing, with its own price (mirror of models/item.py BundleEntry).
export interface BundleEntry {
  name: string;
  product_id: string | null;
  category: ItemCategory | null;
  kind?: ItemKind | null; // "card" for a single card in the bundle (products: "item" / unset)
  code: string | null; // e.g. "ST09"
  image_url: string | null;
  detail: string | null; // what was picked, e.g. "Storage Box · RP-034 (1x)"
  quantity: number;
  price: number | null; // AUD, per unit; null = priced with the bundle as a whole
  purchase_price: number | null; // AUD, per unit
  card_quantities: Record<string, number>; // cards / designs picked in this product, with copies
  card_prices: Record<string, number>; // their optional prices per copy
  parts: string[]; // physical parts of a set in this product, e.g. ["Storage Box", "Playmat"]
  part_prices: Record<string, number>; // their optional prices
}

// A bundle entry's line total (price × quantity), or null when it has no price of its own.
export function bundleLineTotal(entry: BundleEntry): number | null {
  return entry.price == null ? null : entry.price * entry.quantity;
}

/* ---------------- price breakdowns ---------------- */

// Something with an optional price: a picked card (qty = copies), a part, or a product in a bundle.
export interface PricedPart {
  label: string;
  qty: number;
  each: number | null; // price per unit, or null when not priced on its own
}

// One line of a breakdown. The lines always add up to the listing's price:
//  priced   — label, qty × each = amount
//  rest     — everything without its own price, sharing what's left of the price
//  unpriced — the same, while no overall price is set yet (amount null)
//  adjust   — the price is below / above the priced items (a discount / extra)
export interface PriceLine {
  label: string;
  qty: number;
  each: number | null;
  amount: number | null;
  kind: "priced" | "rest" | "unpriced" | "adjust";
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function pricedTotal(parts: PricedPart[]): number {
  return cents(parts.reduce((sum, p) => sum + (p.each == null ? 0 : p.each * p.qty), 0));
}

export function priceBreakdown(parts: PricedPart[], total: number | null): PriceLine[] {
  const priced = parts.filter((p) => p.each != null);
  const unpriced = parts.filter((p) => p.each == null);
  const sum = pricedTotal(parts);
  const lines: PriceLine[] = priced.map((p) => ({ ...p, amount: cents((p.each ?? 0) * p.qty), kind: "priced" }));
  if (unpriced.length > 0) {
    lines.push({
      label: unpriced.map((p) => (p.qty > 1 ? `${p.label} ×${p.qty}` : p.label)).join(", "),
      qty: 1,
      each: null,
      amount: total == null ? null : cents(Math.max(total - sum, 0)),
      kind: total == null ? "unpriced" : "rest",
    });
  }
  if (total != null && priced.length > 0) {
    const diff = cents(total - sum);
    // below the priced items → a discount; above them with nothing unpriced to take it → extra
    if (diff < 0 || (diff > 0 && unpriced.length === 0)) {
      lines.push({ label: diff < 0 ? "Discount" : "Extra", qty: 1, each: null, amount: diff, kind: "adjust" });
    }
  }
  return lines;
}

// Physical parts (storage box, playmat …) as priced parts; a part without a price shares the rest.
// "ASSEMBLE: Gundam ×2" is two of that kit (priced by its name without the count).
export function physicalParts(parts: string[], prices: Record<string, number> | undefined): PricedPart[] {
  return parts.map((p) => {
    const m = /^(.*) ×(\d+)$/.exec(p);
    const label = m ? m[1] : p;
    return { label, qty: m ? Number(m[2]) : 1, each: prices?.[label] ?? null };
  });
}

// The physical parts of a part bundle, from its label ("Storage Box + Playmat + Resources").
export const CARD_PARTS = new Set(["Resources", "Alt-Art Cards", "EX Tokens"]);
export function bundlePartNames(part: string | null): string[] {
  return part && part.includes(" + ") ? part.split(" + ").filter((p) => !CARD_PARTS.has(p)) : [];
}

// A listing's picked cards / designs as priced parts (from card_quantities + card_prices).
export function cardParts(quantities: Record<string, number>, prices: Record<string, number> | undefined): PricedPart[] {
  return Object.entries(quantities ?? {}).map(([label, qty]) => ({
    label: label.replace(/_p\d+$/, ""),
    qty,
    each: prices?.[label] ?? null,
  }));
}

// Mirror of ItemCreate / ItemUpdate
export interface ItemPayload {
  kind: ItemKind;
  name: string;
  color: GundamColor | null;
  card_type: CardType | null;
  rarity: Rarity | null;
  category: ItemCategory | null;
  card_id?: string | null;
  card_no?: string | null;
  set_code?: string | null;
  set_name?: string | null;
  product_id?: string | null;
  edition?: string | null;
  part?: string | null;
  resource_cards?: string[];
  alt_art_cards?: string[];
  sleeve_designs?: string[];
  card_quantities?: Record<string, number>;
  card_prices?: Record<string, number>;
  part_prices?: Record<string, number>;
  bundle_items?: BundleEntry[];
  price: number;
  purchase_price: number | null;
  image_url: string | null;
  quantity: number;
  condition: string | null;
  notes: string | null;
}

// Mirror of routers/cards.py CatalogCard — one printing from the scraped card database.
export interface CatalogCard {
  id: string; // print id, e.g. "GD01-001_p1"
  card_no: string; // e.g. "GD01-001"
  name: string;
  color: GundamColor | null;
  card_type: CardType | null;
  rarity: Rarity | null;
  set_code: string;
  set_name: string | null;
  product: string | null;
  parallel: number; // 0 = base art, 1+ = parallel / alt art
  level: string | null;
  cost: string | null;
  ap: string | null;
  hp: string | null;
  trait: string | null;
  image_url: string;
}

// Mirror of routers/products.py CatalogProduct — one product from the scraped product list.
export interface CatalogProduct {
  id: string; // e.g. "pb01", "sleeve01"
  name: string;
  code: string | null; // e.g. "PB01", "EVX08"
  category: ItemCategory;
  release_date: string | null;
  msrp: string | null; // as shown on the site (USD), e.g. "$89.99"
  // Set when the product is sold in more than one edition (ST01–ST04: Regular Version / Special Edition)
  editions: { name: string; msrp: string | null }[];
  // Premium Bandai sets (PB01, PB02) are sold part by part — the part picker's options
  parts: string[];
  // Resource cards to choose from (multi-select) when the "Resources" part is picked
  resource_cards: { card_no: string; name: string | null; image_url: string }[];
  // Picture of resource cards; add ?cards=RP-025,RP-027 for just those (image for multi-card Resources listings)
  resource_set_image_url: string | null;
  // Picture of a bundle of parts: add ?parts=storage-box,playmat&cards=RP-024,ST02-010_p4
  bundle_image_url: string | null;
  // Photos of the physical parts (PB01, PB02): { "Storage Box": url, "Sleeves": url, … }
  part_images: Record<string, string>;
  // PB01 alt-art printings to choose from (multi-select) when the "Alt-Art Cards" part is picked
  alt_art_cards: { id: string; card_no: string; name: string | null; image_url: string }[];
  // Sleeve designs or set contents to choose from (multi-select), e.g. Official Card Sleeves 01's
  // four designs, or EVX07's storage box + resource cards. fit "contain" = not card-shaped (boxes).
  sleeve_designs: { id: string; name: string; image_url: string; fit: "cover" | "contain" }[];
  sleeve_label: string | null; // picker heading: "Sleeve designs" or "Set contents"
  // Picture of sleeve designs; add ?designs=logo,efsf for just those (image for multi-design listings)
  sleeve_set_image_url: string | null;
  url: string | null;
  image_url: string;
}

export interface CatalogSyncStatus {
  running: boolean;
  stage: string | null;
  done: number;
  total: number;
  error: string | null;
  catalog_count: number;
  synced_at: string | null;
  images_stored: number;
}

// Mirror of StatusUpdate
export interface StatusPayload {
  status: ItemStatus;
  buyer_name?: string | null;
  deal_date?: string | null;
  sale_price?: number | null;
  quantity_sold?: number | null;
}

export type TabId = "all" | "for_sale" | "pending" | "on_hold" | "archive";

export function labelize(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

// sale_price / purchase_price are PER UNIT; deal totals multiply by the quantity in the record.
export function saleTotal(item: CollectionItem): number {
  return (item.sale_price ?? item.price) * item.quantity;
}

export function saleProfit(item: CollectionItem): number | null {
  if (item.purchase_price == null) return null;
  return saleTotal(item) - item.purchase_price * item.quantity;
}

// "ST02-010_p4" → "ST02-010" — alt-art print ids shown as the number printed on the card.
export function cardNumbers(ids: string[]): string {
  return ids.map((id) => id.replace(/_p\d+$/, "")).join(", ");
}

// Picked cards with their copies: "GD02-110 (2x), ST05-010 (1x)" (no count when none recorded).
// Print ids show as the printed number, unless two picks share it (PB03's RP-068 and RP-068_p1).
export function cardCopies(ids: string[], counts?: Record<string, number> | null): string {
  const base = (id: string) => id.replace(/_p\d+$/, "");
  return ids
    .map((id) => {
      const n = counts?.[id];
      const no = ids.filter((other) => base(other) === base(id)).length > 1 ? id : base(id);
      return n ? `${no} (${n}x)` : no;
    })
    .join(", ");
}

// Sold, held or stored as a whole: several products listed together, or a set's picked cards.
export const isBundle = (item: CollectionItem) =>
  (item.bundle_items?.length ?? 0) > 1 || Object.keys(item.card_quantities ?? {}).length > 0;
