import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColorBadge, KindBadge, RarityBadge, StatusBadge } from "@/components/badges";
import { COLOR_TRIM_CLASS, formatAud, formatDate } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { CalendarDays, DollarSign, Pencil, Tag, Trash2, Undo2, User } from "lucide-react";
import type { ItemActionProps } from "@/components/ItemCard";

interface ItemTableProps extends ItemActionProps {
  items: CollectionItem[];
}

type Actions = ItemActionProps;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function typeLabel(item: CollectionItem): string | null {
  return item.card_type ?? item.category ?? null;
}

function ProfitText({ item, className = "" }: { item: CollectionItem; className?: string }) {
  const profit = saleProfit(item);
  if (profit == null) return null;
  return (
    <span
      data-testid={`item-profit-${item.id}`}
      className={`font-mono font-semibold tabular-nums ${profit >= 0 ? "text-emerald-400" : "text-red-400"} ${className}`}
    >
      {profit >= 0 ? "+" : "-"}
      {formatAud(Math.abs(profit))}
    </span>
  );
}

// Optional photo thumbnail — silently disappears if the URL fails to load.
function Thumb({ item, size }: { item: CollectionItem; size: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  if (!item.image_url || failed) return null;
  const dim = size === "sm" ? "size-10" : "size-14";
  return (
    <img
      data-testid={`item-photo-${item.id}`}
      src={item.image_url}
      alt={item.name}
      loading="lazy"
      className={`${dim} shrink-0 rounded-md border border-slate-800/80 object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: dense table (≥1024px)                                      */
/* ------------------------------------------------------------------ */

const TH = "font-mono text-xs uppercase tracking-wider text-slate-400";

function IconActions({ item, actions }: { item: CollectionItem; actions: Actions }) {
  const isSold = item.status === "sold";
  return (
    <div className="flex items-center justify-end gap-1">
      {!isSold && (
        <>
          {item.status === "for_sale" && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Mark ${item.name} as pending`}
              title="Mark Pending"
              data-testid={`item-pending-${item.id}`}
              onClick={() => actions.onMarkPending(item)}
            >
              <Tag className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Mark ${item.name} as sold`}
            title="Mark Sold"
            data-testid={`item-sell-${item.id}`}
            onClick={() => actions.onSell(item)}
            className="text-emerald-400 hover:text-emerald-300"
          >
            <DollarSign className="size-4" />
          </Button>
        </>
      )}
      {item.status === "pending" && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${item.name} back to for sale`}
          title="Back to For Sale"
          data-testid={`item-unmark-${item.id}`}
          onClick={() => actions.onUnmark(item)}
        >
          <Undo2 className="size-4" />
        </Button>
      )}
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
  );
}

function DesktopTable({ items, actions }: { items: CollectionItem[]; actions: Actions }) {
  return (
    <div data-testid="item-table" className="rounded-lg border border-slate-800/80 bg-slate-900/50">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className={TH}>Item</TableHead>
            <TableHead className={TH}>Kind</TableHead>
            <TableHead className={TH}>Color</TableHead>
            <TableHead className={TH}>Type</TableHead>
            <TableHead className={TH}>Rarity</TableHead>
            <TableHead className={TH}>Price</TableHead>
            <TableHead className={TH}>Qty</TableHead>
            <TableHead className={TH}>Status</TableHead>
            <TableHead className={TH}>Deal</TableHead>
            <TableHead className={`${TH} text-right`}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isSold = item.status === "sold";
            return (
              <TableRow key={item.id} data-testid={`item-row-${item.id}`} className="border-slate-800/80">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Thumb item={item} size="sm" />
                    <div className="min-w-0">
                      <p data-testid={`item-name-${item.id}`} className="font-medium text-slate-100">
                        {item.name}
                      </p>
                      {(item.card_no || item.condition) && (
                        <p className="font-mono text-xs text-slate-500" title={item.set_name ?? undefined}>
                          {[item.card_no, item.condition].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {item.notes && (
                        <p className="max-w-64 truncate text-xs text-slate-500" title={item.notes}>
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <KindBadge kind={item.kind} />
                </TableCell>
                <TableCell>
                  <ColorBadge color={item.color} />
                </TableCell>
                <TableCell className="text-sm capitalize text-slate-300">{typeLabel(item) ?? "—"}</TableCell>
                <TableCell>
                  <RarityBadge rarity={item.rarity} />
                </TableCell>
                <TableCell>
                  <p data-testid={`item-price-${item.id}`} className="font-mono font-semibold tabular-nums text-sky-300">
                    {formatAud(isSold ? saleTotal(item) : item.price)}
                  </p>
                  {isSold && (
                    <p className="font-mono text-xs text-slate-500">list {formatAud(item.price)}/unit</p>
                  )}
                  {isSold && (
                    <p className="text-xs">
                      <ProfitText item={item} />
                    </p>
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums text-slate-300">{item.quantity}</TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-sm">
                  {item.buyer_name ? (
                    <div>
                      <p className="text-slate-200">{item.buyer_name}</p>
                      {item.deal_date && (
                        <p className="font-mono text-xs text-slate-500">{formatDate(item.deal_date)}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <IconActions item={item} actions={actions} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile / tablet: stacked list rows (<1024px)                        */
/* ------------------------------------------------------------------ */

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.65rem] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}

function TouchActions({ item, actions }: { item: CollectionItem; actions: Actions }) {
  const isSold = item.status === "sold";
  const btn = "h-9 flex-1 sm:flex-none";
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 flex-wrap gap-2">
        {item.status === "for_sale" && (
          <Button
            size="sm"
            variant="outline"
            className={btn}
            aria-label={`Mark ${item.name} as pending`}
            data-testid={`item-pending-${item.id}`}
            onClick={() => actions.onMarkPending(item)}
          >
            <Tag className="size-4" /> Pending
          </Button>
        )}
        {item.status === "pending" && (
          <Button
            size="sm"
            variant="outline"
            className={btn}
            aria-label={`Move ${item.name} back to for sale`}
            data-testid={`item-unmark-${item.id}`}
            onClick={() => actions.onUnmark(item)}
          >
            <Undo2 className="size-4" /> For Sale
          </Button>
        )}
        {!isSold && (
          <Button
            size="sm"
            className={btn}
            aria-label={`Mark ${item.name} as sold`}
            data-testid={`item-sell-${item.id}`}
            onClick={() => actions.onSell(item)}
          >
            <DollarSign className="size-4" /> Sold
          </Button>
        )}
        {isSold && (
          <Button
            size="sm"
            variant="outline"
            className={btn}
            aria-label={`Restore ${item.name} to inventory`}
            data-testid={`item-restore-${item.id}`}
            onClick={() => actions.onRestore(item)}
          >
            <Undo2 className="size-4" /> Restore
          </Button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`Edit ${item.name}`}
        title="Edit"
        data-testid={`item-edit-${item.id}`}
        onClick={() => actions.onEdit(item)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={`Delete ${item.name}`}
        title="Delete permanently"
        data-testid={`item-delete-${item.id}`}
        onClick={() => actions.onDelete(item)}
        className="text-red-400 hover:text-red-300"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function MobileRow({ item, actions }: { item: CollectionItem; actions: Actions }) {
  const isSold = item.status === "sold";
  const trim = item.kind === "card" && item.color ? COLOR_TRIM_CLASS[item.color] : "border-l-slate-700";
  const type = typeLabel(item);

  return (
    <li
      data-testid={`item-row-${item.id}`}
      className={`space-y-3 rounded-lg border border-l-4 ${trim} border-y-slate-800/80 border-r-slate-800/80 bg-slate-900/60 p-3`}
    >
      {/* Identity */}
      <div className="flex items-start gap-3">
        <Thumb item={item} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p data-testid={`item-name-${item.id}`} className="break-words font-medium leading-snug text-slate-100">
              {item.name}
            </p>
            <StatusBadge status={item.status} />
          </div>
          {(item.card_no || type || item.condition) && (
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {[item.card_no, type, item.condition].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <KindBadge kind={item.kind} />
            {item.color && <ColorBadge color={item.color} />}
            {item.rarity && <RarityBadge rarity={item.rarity} />}
          </div>
        </div>
      </div>

      {/* Numbers */}
      <dl className="grid grid-cols-3 gap-2 rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2">
        <Stat label={isSold ? "Sold for" : "Price"}>
          <span
            data-testid={`item-price-${item.id}`}
            className="font-mono text-sm font-semibold tabular-nums text-sky-300"
          >
            {formatAud(isSold ? saleTotal(item) : item.price)}
          </span>
        </Stat>
        <Stat label="Qty">
          <span className="font-mono text-sm tabular-nums text-slate-200">{item.quantity}</span>
        </Stat>
        {isSold ? (
          <Stat label="List / unit">
            <span className="font-mono text-sm tabular-nums text-slate-400">{formatAud(item.price)}</span>
          </Stat>
        ) : (
          <Stat label="Total">
            <span className="font-mono text-sm tabular-nums text-slate-400">
              {formatAud(item.price * item.quantity)}
            </span>
          </Stat>
        )}
        {isSold && saleProfit(item) != null && (
          <Stat label={(saleProfit(item) ?? 0) >= 0 ? "Profit" : "Loss"}>
            <ProfitText item={item} className="text-sm" />
          </Stat>
        )}
      </dl>

      {/* Deal */}
      {item.buyer_name && (
        <p
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-2.5 py-1.5 text-xs ${
            isSold
              ? "border-green-500/30 bg-green-950/40 text-green-200"
              : "border-amber-500/30 bg-amber-950/40 text-amber-200"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <User className="size-3.5" aria-hidden />
            {isSold ? "Sold to" : "Pending with"} {item.buyer_name}
          </span>
          {item.deal_date && (
            <span className="flex items-center gap-1.5 font-mono">
              <CalendarDays className="size-3.5" aria-hidden /> {formatDate(item.deal_date)}
            </span>
          )}
        </p>
      )}

      {item.notes && <p className="line-clamp-3 text-sm leading-relaxed text-slate-400">{item.notes}</p>}

      <TouchActions item={item} actions={actions} />
    </li>
  );
}

function MobileList({ items, actions }: { items: CollectionItem[]; actions: Actions }) {
  return (
    <ul data-testid="item-table" className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <MobileRow key={item.id} item={item} actions={actions} />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

export default function ItemTable({ items, ...actions }: ItemTableProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  return isDesktop ? (
    <DesktopTable items={items} actions={actions} />
  ) : (
    <MobileList items={items} actions={actions} />
  );
}
