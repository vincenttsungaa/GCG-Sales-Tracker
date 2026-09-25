import type { CardType, GundamColor, Rarity } from "@/lib/types";

export interface InventoryFilters {
  search: string;
  color: GundamColor | "all";
  cardType: CardType | "all";
  rarity: Rarity | "all";
  buyer: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: InventoryFilters = {
  search: "",
  color: "all",
  cardType: "all",
  rarity: "all",
  buyer: "",
  dateFrom: "",
  dateTo: "",
};

export function filtersActive(f: InventoryFilters): boolean {
  return (
    f.search !== "" ||
    f.color !== "all" ||
    f.cardType !== "all" ||
    f.rarity !== "all" ||
    f.buyer !== "" ||
    f.dateFrom !== "" ||
    f.dateTo !== ""
  );
}
