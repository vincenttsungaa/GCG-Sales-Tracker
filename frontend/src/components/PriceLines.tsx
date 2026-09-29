import { formatAud } from "@/lib/format";
import type { PriceLine } from "@/lib/types";

// A price breakdown (see priceBreakdown in lib/types): each priced card / part / product,
// then whatever shares the rest of the price, and any discount — always adding up to the total.
export function PriceLines({ lines, className = "" }: { lines: PriceLine[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <div className={`space-y-0.5 font-mono text-xs ${className}`}>
      {lines.map((l, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-slate-400" title={l.label}>
            {l.label}
            {l.kind === "priced" && l.qty > 1 && l.each != null && (
              <span className="text-slate-500">
                {" "}
                · {l.qty} × {formatAud(l.each)}
              </span>
            )}
            {l.kind === "rest" && <span className="text-slate-500"> (rest of price)</span>}
          </span>
          <span
            className={`shrink-0 tabular-nums ${
              l.kind === "adjust" ? (l.amount != null && l.amount < 0 ? "text-emerald-400" : "text-amber-300") : l.amount == null ? "text-slate-500" : "text-slate-200"
            }`}
          >
            {l.amount == null ? "no price" : l.kind === "adjust" && l.amount < 0 ? `−${formatAud(-l.amount)}` : formatAud(l.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}
