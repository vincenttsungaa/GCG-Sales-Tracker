// Hand-written mirrors of the backend Pydantic models (backend/models/item.py) —
// nothing infers across the HTTP boundary, keep both sides in sync in one edit.

export type ItemKind = "card" | "item";
export type ItemStatus = "for_sale" | "pending" | "sold";

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

export type TabId = "all" | "for_sale" | "pending" | "archive";

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
