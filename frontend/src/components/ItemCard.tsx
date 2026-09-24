import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ColorBadge, KindBadge, RarityBadge, StatusBadge } from "@/components/badges";
import { COLOR_TRIM_CLASS, formatAud, formatDate } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem } from "@/lib/types";
import { Archive, CalendarDays, Pencil, Tag, Trash2, Undo2, User } from "lucide-react";

// Optional photo thumbnail — silently disappears if the URL fails to load.
function ItemPhoto({ item }: { item: CollectionItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.image_url || failed) return null;
  return (
    <div data-testid={`item-photo-${item.id}`} className="overflow-hidden rounded-md border border-slate-800/80">
      <img
        src={item.image_url}
        alt={item.name}
        className="h-32 w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export interface ItemActionProps {
  onEdit: (item: CollectionItem) => void;
  onMarkPending: (item: CollectionItem) => void;
  onSell: (item: CollectionItem) => void;
  onRestore: (item: CollectionItem) => void;
  onDelete: (item: CollectionItem) => void;
  onUnmark: (item: CollectionItem) => void;
}

interface ItemCardProps extends ItemActionProps {
  item: CollectionItem;
}

export default function ItemCard({ item, ...actions }: ItemCardProps) {
  const isSold = item.status === "sold";
  const trim = item.kind === "card" && item.color ? COLOR_TRIM_CLASS[item.color] : "border-l-slate-700";

  return (
    <Card
      data-testid={`item-card-${item.id}`}
      className={`border-l-4 ${trim} border-y-slate-800/80 border-r-slate-800/80 bg-slate-900/60 transition-all duration-200 hover:-translate-y-1 hover:border-sky-500/40 hover:shadow-[0_0_24px_rgba(56,189,248,0.12)]`}
    >
      <CardContent className="space-y-3 px-4 py-4">
        <ItemPhoto item={item} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 data-testid={`item-name-${item.id}`} className="truncate font-heading text-base font-bold uppercase tracking-tight text-slate-100">
              {item.name}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {item.kind === "card" ? item.card_type ?? "card" : item.category ?? "item"}
              {item.condition ? ` · ${item.condition}` : ""}
            </p>
          </div>
          <StatusBadge status={item.status} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={item.kind} />
          {item.kind === "card" && <ColorBadge color={item.color} />}
          {item.kind === "card" && <RarityBadge rarity={item.rarity} />}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              {isSold ? "Sold for" : "Asking"}
            </p>
            <p data-testid={`item-price-${item.id}`} className="font-mono text-lg font-semibold tabular-nums text-sky-300">
              {formatAud(isSold ? saleTotal(item) : item.price)}
            </p>
            {isSold && saleProfit(item) != null && (
              <p
                data-testid={`item-profit-${item.id}`}
                className={`font-mono text-xs font-semibold tabular-nums ${(saleProfit(item) ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {(saleProfit(item) ?? 0) >= 0 ? "Profit" : "Loss"} {formatAud(Math.abs(saleProfit(item) ?? 0))}
              </p>
            )}
            <p className="font-mono text-xs text-slate-500">qty {item.quantity}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${item.name}`}
              title="Edit"
              data-testid={`item-edit-${item.id}`}
              onClick={() => actions.onEdit(item)}
            >
              <Pencil className="size-4" />
            </Button>
            {isSold && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Restore ${item.name} to inventory`}
                title="Restore to inventory"
                data-testid={`item-restore-${item.id}`}
                onClick={() => actions.onRestore(item)}
              >
                <Undo2 className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${item.name}`}
              title="Delete permanently"
              data-testid={`item-delete-${item.id}`}
              onClick={() => actions.onDelete(item)}
              className="text-red-400 hover:text-red-300"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {item.notes && <p className="line-clamp-2 text-sm leading-relaxed text-slate-400">{item.notes}</p>}

        {item.status === "pending" && item.buyer_name && (
          <p className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-950/40 px-2.5 py-1.5 text-xs text-amber-200">
            <User className="size-3.5" aria-hidden /> Pending with {item.buyer_name}
            {item.deal_date && (
              <>
                <CalendarDays className="ml-1 size-3.5" aria-hidden /> {formatDate(item.deal_date)}
              </>
            )}
          </p>
        )}

        {isSold && item.buyer_name && (
          <p className="flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-950/40 px-2.5 py-1.5 text-xs text-green-200">
            <Tag className="size-3.5" aria-hidden /> Sold to {item.buyer_name}
            {item.deal_date && (
              <>
                <CalendarDays className="ml-1 size-3.5" aria-hidden /> {formatDate(item.deal_date)}
              </>
            )}
            <Archive className="ml-auto hidden size-3.5" aria-hidden />
          </p>
        )}

        {!isSold && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {item.status === "for_sale" && (
              <Button
                size="xs"
                variant="outline"
                data-testid={`item-pending-${item.id}`}
                onClick={() => actions.onMarkPending(item)}
              >
                Mark Pending
              </Button>
            )}
            <Button
              size="xs"
              className="col-start-2"
              data-testid={`item-sell-${item.id}`}
              onClick={() => actions.onSell(item)}
            >
              Mark Sold
            </Button>
            {item.status === "pending" && (
              <Button
                size="xs"
                variant="ghost"
                data-testid={`item-unmark-${item.id}`}
                onClick={() => actions.onUnmark(item)}
              >
                Back to For Sale
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
