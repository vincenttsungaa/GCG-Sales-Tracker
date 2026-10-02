import { Badge } from "@/components/ui/badge";
import { Layers, Package } from "lucide-react";
import { COLOR_DOT_CLASS, STATUS_BADGE_CLASS } from "@/lib/format";
import { labelize, type GundamColor, type ItemKind, type ItemStatus, type Rarity } from "@/lib/types";

export function StatusBadge({ status }: { status: ItemStatus }) {
  const labels: Record<ItemStatus, string> = {
    for_sale: "For Sale",
    pending: "Pending",
    on_hold: "Storage",
    sold: "Sold",
  };
  return (
    <Badge
      data-testid={`status-badge-${status}`}
      className={`${STATUS_BADGE_CLASS[status]} border font-medium`}
    >
      {labels[status]}
    </Badge>
  );
}

export function ColorBadge({ color }: { color: GundamColor | null }) {
  if (!color) return <span className="text-sm text-slate-500">—</span>;
  return (
    <Badge
      data-testid={`color-badge-${color}`}
      variant="outline"
      className="gap-1.5 border-slate-600/60 bg-slate-800/60 text-slate-100"
    >
      <span className={`size-2 rounded-full ${COLOR_DOT_CLASS[color]}`} aria-hidden />
      {labelize(color)}
    </Badge>
  );
}

// oxlint-disable-next-line react/only-export-components -- shared colour map for rarity chips
export function rarityClass(rarity: Rarity): string {
  if (rarity.startsWith("LR")) return "border-amber-500/50 bg-amber-950/70 text-amber-200";
  if (rarity === "SP") return "border-fuchsia-500/50 bg-fuchsia-950/70 text-fuchsia-200";
  if (rarity.startsWith("P")) return "border-orange-500/50 bg-orange-950/70 text-orange-200";
  if (rarity.startsWith("LK")) return "border-cyan-500/50 bg-cyan-950/70 text-cyan-200";
  if (rarity.startsWith("U")) return "border-sky-500/50 bg-sky-950/70 text-sky-200";
  if (rarity.startsWith("R")) return "border-blue-500/50 bg-blue-950/70 text-blue-200";
  return "border-slate-500/50 bg-slate-800/70 text-slate-200";
}

// Item chips (the box icon on item tiles): one colour per category, like the rarity chips on cards.
// Bundles of several products get their own colour.
// oxlint-disable-next-line react/only-export-components -- shared colour map for category chips
export function categoryClass(item: { category: string | null; bundle_items?: unknown[] | null }): string {
  if ((item.bundle_items?.length ?? 0) > 1) return "border-teal-400/60 bg-teal-950/70 text-teal-200";
  switch (item.category) {
    case "starter deck":
      return "border-emerald-400/60 bg-emerald-950/70 text-emerald-200";
    case "accessories":
      return "border-violet-400/60 bg-violet-950/70 text-violet-200";
    case "premium bandai":
      return "border-rose-400/60 bg-rose-950/70 text-rose-200";
    default:
      return "border-slate-500/50 bg-slate-800/70 text-slate-200";
  }
}

export function RarityBadge({ rarity }: { rarity: Rarity | null }) {
  if (!rarity) return <span className="text-sm text-slate-500">—</span>;
  return (
    <Badge
      data-testid={`rarity-badge-${rarity}`}
      className={`border font-mono font-semibold tracking-wide ${rarityClass(rarity)}`}
    >
      {rarity}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: ItemKind }) {
  return (
    <Badge
      data-testid={`kind-badge-${kind}`}
      variant="outline"
      className="gap-1.5 border-slate-600/60 text-slate-300"
    >
      {kind === "card" ? <Layers className="size-3" /> : <Package className="size-3" />}
      {labelize(kind)}
    </Badge>
  );
}
