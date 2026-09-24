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

export const RARITIES = [
  "C",
  "C+",
  "C++",
  "UC",
  "UC+",
  "R",
  "R+",
  "LR",
  "LR+",
  "LR++",
  "SP",
  "P",
  "LK",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const ITEM_CATEGORIES = [
  "booster box",
  "playmat",
  "sleeves",
  "deck box",
  "binder",
  "model kit",
  "other",
] as const;
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
  price: number;
  purchase_price: number | null;
  image_url: string | null;
  quantity: number;
  condition: string | null;
  notes: string | null;
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
