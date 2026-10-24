import { Card, CardContent } from "@/components/ui/card";
import { formatAud } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem } from "@/lib/types";

// Phones: the three tiles sit side by side, compact — a short label, the number, no sub line.
function StatTile({
  label,
  short,
  value,
  sub,
  testId,
  accent,
}: {
  label: string;
  short: string; // the label on phones
  value: string;
  sub: string;
  testId: string;
  accent: string;
}) {
  return (
    <Card size="sm" className="border-slate-800/80 bg-slate-900/60 max-sm:py-0" title={`${label}: ${value} · ${sub}`}>
      <CardContent className="min-w-0 space-y-0.5 px-2.5 py-2 sm:space-y-1 sm:px-4 sm:py-3 lg:space-y-0 lg:py-2">
        <p className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p
          data-testid={testId}
          className={`truncate font-mono text-sm font-semibold tabular-nums sm:text-2xl lg:text-lg ${accent}`}
        >
          {value}
        </p>
        <p className="hidden text-xs text-slate-500 sm:block">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function StatsStrip({ items }: { items: CollectionItem[] }) {
  const active = items.filter((i) => i.status !== "sold");
  const collectionValue = active.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const sold = items.filter((i) => i.status === "sold");
  const cardCount = active
    .filter((i) => i.kind === "card")
    .reduce((sum, i) => sum + i.quantity, 0);
  const itemCount = active
    .filter((i) => i.kind === "item")
    .reduce((sum, i) => sum + i.quantity, 0);
  const realized = sold.reduce((sum, i) => sum + saleTotal(i), 0);
  const profit = sold.reduce((sum, i) => sum + (saleProfit(i) ?? 0), 0);

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1 lg:gap-2">
      <StatTile
        testId="stat-collection-value"
        label="Collection Value"
        short="Value"
        value={formatAud(collectionValue)}
        sub="Active items at list price (AUD)"
        accent="text-slate-100"
      />
      <StatTile
        testId="stat-realized-sales"
        label="Realized Sales"
        short="Sales"
        value={formatAud(realized)}
        sub={`${formatAud(Math.abs(profit))} ${profit >= 0 ? "profit" : "loss"} after costs · ${sold.length} sold`}
        accent="text-emerald-300"
      />
      <StatTile
        testId="stat-kind-counts"
        label="Cards & Items"
        short="Items"
        value={`${cardCount + itemCount}`}
        sub={`${cardCount} card${cardCount === 1 ? "" : "s"} · ${itemCount} item${itemCount === 1 ? "" : "s"}`}
        accent="text-sky-300"
      />
    </div>
  );
}
