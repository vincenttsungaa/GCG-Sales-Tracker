import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterX } from "lucide-react";
import { COLOR_DOT_CLASS } from "@/lib/format";
import {
  CARD_TYPES,
  GUNDAM_COLORS,
  RARITIES,
  labelize,
  type CardType,
  type GundamColor,
  type Rarity,
} from "@/lib/types";

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

interface FilterBarProps {
  filters: InventoryFilters;
  onChange: (next: InventoryFilters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const set = (patch: Partial<InventoryFilters>) => onChange({ ...filters, ...patch });

  return (
    <div
      data-testid="filter-bar"
      className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-900/50 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Name search */}
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <Label htmlFor="filter-search" className="font-mono text-xs uppercase tracking-wider text-slate-400">
            Search name
          </Label>
          <Input
            id="filter-search"
            data-testid="filter-search"
            placeholder="e.g. Sazabi"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            className="bg-slate-950/60"
          />
        </div>
        {/* Type */}
        <div className="flex min-w-36 flex-col gap-1.5">
          <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Type</Label>
          <Select
            value={filters.cardType}
            onValueChange={(value: string) => set({ cardType: value as CardType | "all" })}
          >
            <SelectTrigger data-testid="filter-type" className="w-full bg-slate-950/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {CARD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {labelize(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Rarity */}
        <div className="flex min-w-28 flex-col gap-1.5">
          <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Rarity</Label>
          <Select
            value={filters.rarity}
            onValueChange={(value: string) => set({ rarity: value as Rarity | "all" })}
          >
            <SelectTrigger data-testid="filter-rarity" className="w-full bg-slate-950/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rarities</SelectItem>
              {RARITIES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Buyer */}
        <div className="flex min-w-40 flex-col gap-1.5">
          <Label htmlFor="filter-buyer" className="font-mono text-xs uppercase tracking-wider text-slate-400">
            Buyer
          </Label>
          <Input
            id="filter-buyer"
            data-testid="filter-buyer"
            placeholder="Buyer name"
            value={filters.buyer}
            onChange={(e) => set({ buyer: e.target.value })}
            className="bg-slate-950/60"
          />
        </div>
        {/* Deal date range */}
        <div className="flex flex-col gap-1.5">
          <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">
            Deal date
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              data-testid="filter-date-from"
              aria-label="Deal date from"
              value={filters.dateFrom}
              onChange={(e) => set({ dateFrom: e.target.value })}
              className="bg-slate-950/60 [color-scheme:dark]"
            />
            <span className="text-slate-500">→</span>
            <Input
              type="date"
              data-testid="filter-date-to"
              aria-label="Deal date to"
              value={filters.dateTo}
              onChange={(e) => set({ dateTo: e.target.value })}
              className="bg-slate-950/60 [color-scheme:dark]"
            />
          </div>
        </div>
        {filtersActive(filters) && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="filter-clear"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="text-slate-400"
          >
            <FilterX className="size-4" /> Clear
          </Button>
        )}
      </div>

      {/* Color pills */}
      <div className="flex flex-wrap items-center gap-2" data-testid="filter-colors">
        <span className="font-mono text-xs uppercase tracking-wider text-slate-400">Color</span>
        <Button
          size="xs"
          variant={filters.color === "all" ? "secondary" : "outline"}
          data-testid="filter-color-all"
          onClick={() => set({ color: "all" })}
        >
          All
        </Button>
        {GUNDAM_COLORS.map((color) => (
          <Button
            key={color}
            size="xs"
            variant={filters.color === color ? "secondary" : "outline"}
            data-testid={`filter-color-${color}`}
            onClick={() => set({ color: filters.color === color ? "all" : color })}
            className="gap-1.5"
          >
            <span className={`size-2 rounded-full ${COLOR_DOT_CLASS[color]}`} aria-hidden />
            {labelize(color)}
          </Button>
        ))}
      </div>
    </div>
  );
}
