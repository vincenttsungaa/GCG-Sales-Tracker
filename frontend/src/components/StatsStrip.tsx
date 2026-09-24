import { Card, CardContent } from "@/components/ui/card";
import { formatAud } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem } from "@/lib/types";

function StatTile({
  label,
  value,
  sub,
  testId,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  testId: string;
  accent: string;
}) {
  return (
    <Card size="sm" className="border-slate-800/80 bg-slate-900/60">
      <CardContent className="space-y-1 px-4 py-3">
        <p className="font-mono text-xs uppercase tracking-wider text-slate-400">{label}</p>
        <p
          data-testid={testId}
          className={`font-mono text-2xl font-semibold tabular-nums ${accent}`}
        >
          {value}
        </p>
        <p className="text-xs text-slate-500">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function StatsStrip({ items }: { items: CollectionItem[] }) {
  const active = items.filter((i) => i.status !== "sold");
  const totalUnits = active.reduce((sum, i) => sum + i.quantity, 0);
  const collectionValue = active.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const forSaleCount = items.filter((i) => i.status === "for_sale").length;
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const sold = items.filter((i) => i.status === "sold");
  const realized = sold.reduce((sum, i) => sum + saleTotal(i), 0);
  const profit = sold.reduce((sum, i) => sum + (saleProfit(i) ?? 0), 0);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        testId="stat-active-items"
        label="Active Inventory"
        value={String(active.length)}
        sub={`${totalUnits} total unit${totalUnits === 1 ? "" : "s"} owned`}
        accent="text-sky-300"
      />
      <StatTile
        testId="stat-collection-value"
        label="Collection Value"
        value={formatAud(collectionValue)}
        sub="Active items at list price (AUD)"
        accent="text-slate-100"
      />
      <StatTile
        testId="stat-open-deals"
        label="Open Deals"
        value={`${forSaleCount + pendingCount}`}
        sub={`${forSaleCount} for sale · ${pendingCount} pending`}
        accent="text-amber-300"
      />
      <StatTile
        testId="stat-realized-sales"
        label="Realized Sales"
        value={formatAud(realized)}
        sub={`${formatAud(Math.abs(profit))} ${profit >= 0 ? "profit" : "loss"} after costs · ${sold.length} sold`}
        accent="text-emerald-300"
      />
    </div>
  );
}
