import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge, rarityClass } from "@/components/badges";
import { COLOR_DOT_CLASS, formatAud, formatDate } from "@/lib/format";
import { labelize, saleProfit, saleTotal, type CollectionItem } from "@/lib/types";
import { CalendarDays, DollarSign, Layers, Package, Pencil, Tag, Trash2, Undo2, User } from "lucide-react";

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

// Card art in the real card ratio (63 × 88 mm). Falls back to an icon if there is no image.
function CardArt({ item }: { item: CollectionItem }) {
  const [failed, setFailed] = useState(false);
  const showImage = item.image_url && !failed;
  return (
    <div className="relative aspect-[63/88] overflow-hidden rounded-md border border-slate-800/80 bg-slate-950/70">
      {showImage ? (
        <img
          data-testid={`item-photo-${item.id}`}
          src={item.image_url ?? undefined}
          alt={item.name}
          loading="lazy"
          className={`size-full ${item.kind === "card" ? "object-cover" : "object-contain p-1"}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-slate-600">
          {item.kind === "card" ? <Layers className="size-8" aria-hidden /> : <Package className="size-8" aria-hidden />}
          <span className="font-mono text-[0.65rem] uppercase tracking-wider">
            {item.kind === "card" ? "No image" : (item.category ?? "Item")}
          </span>
        </div>
      )}
      {item.quantity > 1 && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md border border-slate-700 bg-slate-950/90 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-100">
          ×{item.quantity}
        </span>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="shrink-0 font-mono text-[0.65rem] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

export default function ItemCard({ item, ...actions }: ItemCardProps) {
  const isSold = item.status === "sold";
  const profit = isSold ? saleProfit(item) : null;
  const typeText = item.kind === "card" ? item.card_type : item.category;

  return (
    <article
      data-testid={`item-card-${item.id}`}
      className="flex flex-col gap-2.5 rounded-xl border border-slate-800/80 bg-[#10151F] p-2.5 transition-colors duration-200 hover:border-sky-500/40"
    >
      {/* Header — rarity chip + card number, like the official card list */}
      <div className="flex items-center gap-2">
        {item.rarity ? (
          <span
            data-testid={`rarity-badge-${item.rarity}`}
            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1 font-mono text-xs font-bold ${rarityClass(item.rarity)}`}
          >
            {item.rarity}
          </span>
        ) : (
          <span className="inline-flex size-6 items-center justify-center rounded-md border border-slate-700 text-slate-500">
            {item.kind === "card" ? <Layers className="size-3.5" aria-hidden /> : <Package className="size-3.5" aria-hidden />}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-slate-300">
          {item.card_no ?? item.set_code ?? (item.kind === "card" ? "Card" : "Item")}
        </span>
      </div>

      <div className="relative">
        <CardArt item={item} />
        <div className="absolute top-1.5 left-1.5 drop-shadow">
          <StatusBadge status={item.status} />
        </div>
      </div>

      {/* Name + identity */}
      <div className="min-w-0 space-y-1">
        <h3
          data-testid={`item-name-${item.id}`}
          className="line-clamp-2 font-heading text-base leading-tight font-bold text-slate-100"
          title={item.name}
        >
          {item.name}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
          {item.color && (
            <span className="flex items-center gap-1" data-testid={`color-badge-${item.color}`}>
              <span className={`size-2 rounded-full ${COLOR_DOT_CLASS[item.color]}`} aria-hidden />
              {labelize(item.color)}
            </span>
          )}
          {typeText && <span className="capitalize">{typeText}</span>}
          {item.set_code && item.kind === "card" && (
            <span className="font-mono text-slate-500" title={item.set_name ?? undefined}>
              {item.set_code}
            </span>
          )}
          {item.condition && <span className="text-slate-500">{item.condition}</span>}
        </div>
      </div>

      {/* Money + qty */}
      <div className="space-y-1 rounded-md border border-slate-800/60 bg-slate-950/40 px-2 py-1.5">
        <Detail label={isSold ? "Sold for" : "Asking"}>
          <span data-testid={`item-price-${item.id}`} className="font-mono font-semibold tabular-nums text-sky-300">
            {formatAud(isSold ? saleTotal(item) : item.price)}
          </span>
        </Detail>
        {isSold && (
          <Detail label="List">
            <span className="font-mono tabular-nums text-slate-400">{formatAud(item.price)}/unit</span>
          </Detail>
        )}
        {item.purchase_price != null && (
          <Detail label="Paid">
            <span className="font-mono tabular-nums text-slate-400">{formatAud(item.purchase_price)}/unit</span>
          </Detail>
        )}
        {profit != null && (
          <Detail label={profit >= 0 ? "Profit" : "Loss"}>
            <span
              data-testid={`item-profit-${item.id}`}
              className={`font-mono font-semibold tabular-nums ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {profit >= 0 ? "+" : "-"}
              {formatAud(Math.abs(profit))}
            </span>
          </Detail>
        )}
        <Detail label="Qty">
          <span className="font-mono tabular-nums text-slate-200">{item.quantity}</span>
        </Detail>
      </div>

      {item.buyer_name && (
        <p
          className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 text-xs ${
            isSold
              ? "border-green-500/30 bg-green-950/40 text-green-200"
              : "border-amber-500/30 bg-amber-950/40 text-amber-200"
          }`}
        >
          <span className="flex min-w-0 items-center gap-1">
            <User className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{item.buyer_name}</span>
          </span>
          {item.deal_date && (
            <span className="flex items-center gap-1 font-mono">
              <CalendarDays className="size-3" aria-hidden /> {formatDate(item.deal_date)}
            </span>
          )}
        </p>
      )}

      {item.notes && (
        <p className="line-clamp-2 text-xs leading-relaxed text-slate-400" title={item.notes}>
          {item.notes}
        </p>
      )}

      {/* Actions — pinned to the bottom so tiles in a row line up */}
      <div className="mt-auto flex items-center gap-1 border-t border-slate-800/60 pt-2">
        {item.status === "for_sale" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Mark ${item.name} as pending`}
            title="Mark Pending"
            data-testid={`item-pending-${item.id}`}
            onClick={() => actions.onMarkPending(item)}
          >
            <Tag className="size-4" />
          </Button>
        )}
        {item.status === "pending" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${item.name} back to for sale`}
            title="Back to For Sale"
            data-testid={`item-unmark-${item.id}`}
            onClick={() => actions.onUnmark(item)}
          >
            <Undo2 className="size-4" />
          </Button>
        )}
        {!isSold && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Mark ${item.name} as sold`}
            title="Mark Sold"
            data-testid={`item-sell-${item.id}`}
            onClick={() => actions.onSell(item)}
            className="text-emerald-400 hover:text-emerald-300"
          >
            <DollarSign className="size-4" />
          </Button>
        )}
        {isSold && (
          <Button
            variant="ghost"
            size="icon-sm"
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
          size="icon-sm"
          aria-label={`Edit ${item.name}`}
          title="Edit"
          data-testid={`item-edit-${item.id}`}
          onClick={() => actions.onEdit(item)}
          className="ml-auto"
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${item.name}`}
          title="Delete permanently"
          data-testid={`item-delete-${item.id}`}
          onClick={() => actions.onDelete(item)}
          className="text-red-400 hover:text-red-300"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </article>
  );
}
