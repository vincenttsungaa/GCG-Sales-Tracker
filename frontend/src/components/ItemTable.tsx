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
import { formatAud, formatDate } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem } from "@/lib/types";
import { Pencil, Tag, DollarSign, Trash2, Undo2 } from "lucide-react";
import type { ItemActionProps } from "@/components/ItemCard";

interface ItemTableProps extends ItemActionProps {
  items: CollectionItem[];
}

export default function ItemTable({ items, ...actions }: ItemTableProps) {
  return (
    <div data-testid="item-table" className="rounded-lg border border-slate-800/80 bg-slate-900/50">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Item</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Kind</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Color</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Type</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Rarity</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Price</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Qty</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Status</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400">Deal</TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-slate-400 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isSold = item.status === "sold";
            return (
              <TableRow key={item.id} data-testid={`item-row-${item.id}`} className="border-slate-800/80">
                <TableCell>
                  <p data-testid={`item-name-${item.id}`} className="font-medium text-slate-100">
                    {item.name}
                  </p>
                  {item.notes && <p className="max-w-64 truncate text-xs text-slate-500">{item.notes}</p>}
                </TableCell>
                <TableCell>
                  <KindBadge kind={item.kind} />
                </TableCell>
                <TableCell>
                  <ColorBadge color={item.color} />
                </TableCell>
                <TableCell className="text-sm text-slate-300">
                  {item.card_type ?? item.category ?? "—"}
                </TableCell>
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
                  {isSold && saleProfit(item) != null && (
                    <p
                      data-testid={`item-profit-${item.id}`}
                      className={`font-mono text-xs font-semibold tabular-nums ${(saleProfit(item) ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {(saleProfit(item) ?? 0) >= 0 ? "+" : "-"}
                      {formatAud(Math.abs(saleProfit(item) ?? 0))}
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
