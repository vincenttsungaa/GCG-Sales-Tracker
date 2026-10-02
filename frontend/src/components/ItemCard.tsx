import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge, categoryClass, rarityClass } from "@/components/badges";
import { COLOR_DOT_CLASS, formatAud, formatDate } from "@/lib/format";
import {
  bundleLineTotal,
  bundlePartNames,
  cardCopies,
  cardNumbers,
  cardParts,
  labelize,
  physicalParts,
  priceBreakdown,
  saleProfit,
  saleTotal,
  type CollectionItem,
  type PricedPart,
} from "@/lib/types";
import { PriceLines } from "@/components/PriceLines";
import { OverflowTip } from "@/components/InfoTip";
import { CalendarDays, ChevronDown, DollarSign, Layers, Package, Lock, Pencil, Tag, Trash2, Undo2, User } from "lucide-react";

export interface ItemActionProps {
  onEdit: (item: CollectionItem) => void;
  onMarkPending: (item: CollectionItem) => void;
  onHold: (item: CollectionItem) => void; // move to storage (kept, not for sale for now)
  onSell: (item: CollectionItem) => void;
  onRestore: (item: CollectionItem) => void;
  onDelete: (item: CollectionItem) => void;
  onUnmark: (item: CollectionItem) => void;
  // Select mode (delete several at once): a checkbox on each listing
  selecting?: boolean;
  isSelected?: (item: CollectionItem) => boolean;
  onToggleSelect?: (item: CollectionItem) => void;
}

// Select mode: a click anywhere on a listing (tile or row) ticks / unticks it — except on its own
// buttons, links and inputs (price breakdown, edit, delete, the checkbox itself …).
export function selectOnClick(item: CollectionItem, actions: ItemActionProps) {
  return (e: { target: EventTarget | null }) => {
    if (!actions.selecting) return;
    if (e.target instanceof Element && e.target.closest("button, a, input, select, textarea, label, [role='button']")) return;
    actions.onToggleSelect?.(item);
  };
}

// The select-mode checkbox for a listing (tile, table row or mobile row); nothing outside select mode.
export function SelectBox({ item, actions }: { item: CollectionItem; actions: ItemActionProps }) {
  if (!actions.selecting) return null;
  return (
    <input
      type="checkbox"
      checked={actions.isSelected?.(item) ?? false}
      onChange={() => actions.onToggleSelect?.(item)}
      aria-label={`Select ${item.name}`}
      data-testid={`item-select-${item.id}`}
      className="size-4 shrink-0 cursor-pointer accent-sky-500"
    />
  );
}

interface ItemCardProps extends ItemActionProps {
  item: CollectionItem;
}

const PART_PHOTO_PARTS = new Set([
  "Storage Box", "Sleeves", "Playmat", "Deck Box", "Divider",
  "Sleeves (Blue)", "Sleeves (Green)", "Card Case", "Damage Counter Dice", // PB03
  "Booster Pack", // Edition Beta (ASSEMBLE kit photos are on black, so they keep the dark tile)
]);

// Card art in the real card ratio (63 × 88 mm). Falls back to an icon if there is no image.
function CardArt({ item }: { item: CollectionItem }) {
  // PB01/PB02 part photos (storage box, sleeves, playmat, deck box, divider) are shown on white,
  // so the space above and below a wide photo is white instead of the dark tile background.
  const whiteBackdrop = !!item.part && PART_PHOTO_PARTS.has(item.part);
  const [failed, setFailed] = useState(false);
  const showImage = item.image_url && !failed;
  const bundle = item.bundle_items ?? [];
  if (bundle.length > 1) {
    // A bundle of products (e.g. ST09 + ST01): a collage of their pictures (up to 4; "+N" for the rest).
    const shown = bundle.length > 4 ? bundle.slice(0, 3) : bundle;
    return (
      <div
        data-testid={`item-photo-${item.id}`}
        className="grid aspect-[63/88] grid-cols-2 content-center gap-1 overflow-hidden rounded-md border border-slate-800/80 bg-slate-950/70 p-1"
      >
        {shown.map((e, i) =>
          e.image_url ? (
            <img key={i} src={e.image_url} alt={e.name} loading="lazy" className="aspect-square w-full rounded bg-slate-900 object-contain" />
          ) : (
            <div key={i} className="flex aspect-square items-center justify-center rounded bg-slate-900 text-slate-600">
              <Package className="size-6" aria-hidden />
            </div>
          ),
        )}
        {bundle.length > 4 && (
          <div className="flex aspect-square items-center justify-center rounded bg-slate-900 font-mono text-sm text-slate-300">
            +{bundle.length - 3}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`relative aspect-[63/88] overflow-hidden rounded-md border border-slate-800/80 ${
        whiteBackdrop && showImage ? "bg-white" : "bg-slate-950/70"
      }`}
    >
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
  // The per-item price breakdown is folded away until asked for ("Price breakdown ▾").
  const [showPrices, setShowPrices] = useState(false);
  // The list of items / cards in a listing is folded to one summary line until opened.
  const [showItems, setShowItems] = useState(false);
  const isSold = item.status === "sold";
  const profit = isSold ? saleProfit(item) : null;
  const typeText = item.kind === "card" ? item.card_type : item.category;
  // Resources / Alt-Art Cards listings with copies per card (PB01, PB02), and sleeve designs
  const pickedCards = [...item.resource_cards, ...item.alt_art_cards, ...(item.sleeve_designs ?? [])];
  const hasCopies = pickedCards.length > 0 && Object.keys(item.card_quantities ?? {}).length > 0;
  const qtyCode = item.card_no ?? item.set_code;
  const qtyLabel = qtyCode ? `${qtyCode} (${item.quantity}x)` : `${item.quantity}x`;
  // Several parts of a set listed together ("Storage Box + Playmat + Resources"): Qty counts bundles,
  // the card copies are what's in each one.
  const isBundle = !!item.part?.includes(" + ");
  // Several products listed together (e.g. ST09 + ST01), each with its own price.
  const bundleItems = item.bundle_items ?? [];
  // Picked cards / designs with their own prices; in a part bundle the other parts share the rest.
  const cardPriceParts: PricedPart[] =
    Object.keys(item.card_prices ?? {}).length + Object.keys(item.part_prices ?? {}).length === 0
      ? []
      : [...physicalParts(bundlePartNames(item.part), item.part_prices), ...cardParts(item.card_quantities, item.card_prices)];
  const hasBreakdown = bundleItems.length > 1 || cardPriceParts.length > 0;
  // Foldable list: the products in a bundle, or the cards / designs picked (2 or more).
  const pickedCopies = Object.values(item.card_quantities ?? {}).reduce((sum, n) => sum + n, 0);
  const pickNoun = (item.sleeve_designs ?? []).length > 0 ? "items" : "cards";
  const foldList = bundleItems.length > 1 || (hasCopies && pickedCards.length > 1);
  const listSummary =
    bundleItems.length > 1
      ? `${bundleItems.length} items`
      : isBundle
        ? `${qtyLabel} · ${pickedCopies} ${pickNoun} per bundle`
        : `${pickedCards.length} ${pickNoun}${pickedCopies > pickedCards.length ? ` · ${pickedCopies} copies` : ""}`;

  return (
    <article
      data-testid={`item-card-${item.id}`}
      onClick={selectOnClick(item, actions)}
      aria-selected={actions.selecting ? (actions.isSelected?.(item) ?? false) : undefined}
      className={`flex flex-col gap-2.5 rounded-xl border bg-[#10151F] p-2.5 transition-colors duration-200 hover:border-sky-500/40 ${
        actions.selecting ? "cursor-pointer select-none" : ""
      } ${
        actions.selecting && actions.isSelected?.(item) ? "border-sky-500 ring-1 ring-sky-500/60" : "border-slate-800/80"
      }`}
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
          // items: the box icon coloured by category, like the rarity chips on cards
          <span
            data-testid={`category-chip-${item.category ?? "none"}`}
            title={item.kind === "card" ? "Card" : labelize(item.category ?? "item")}
            className={`inline-flex size-6 items-center justify-center rounded-md border ${
              item.kind === "card" ? "border-slate-700 text-slate-500" : categoryClass(item)
            }`}
          >
            {item.kind === "card" ? <Layers className="size-3.5" aria-hidden /> : <Package className="size-3.5" aria-hidden />}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold tracking-wide text-slate-300">
          {item.card_no ?? item.set_code ?? (item.kind === "card" ? "Card" : "Item")}
        </span>
        <SelectBox item={item} actions={actions} />
      </div>

      <div className="relative">
        <CardArt item={item} />
        <div className="absolute top-1.5 left-1.5 drop-shadow">
          <StatusBadge status={item.status} />
        </div>
      </div>

      {/* Name + identity */}
      <div className="min-w-0 space-y-1">
        {/* long names are cut to two lines; hovering shows the full name */}
        <OverflowTip text={item.name}>
          <h3
            data-testid={`item-name-${item.id}`}
            className="line-clamp-2 font-heading text-base leading-tight font-bold text-slate-100"
          >
            {item.name}
          </h3>
        </OverflowTip>
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
          {item.part && (
            <span className="rounded border border-sky-500/40 px-1 text-sky-300" data-testid={`item-part-${item.id}`}>
              {item.part}
            </span>
          )}
          {item.edition && (
            <span className="rounded border border-amber-500/40 px-1 text-amber-300" data-testid={`item-edition-${item.id}`}>
              {item.edition}
            </span>
          )}
          {item.condition && <span className="text-slate-500">{item.condition}</span>}
        </div>
      </div>

      {/* Qty for the grid view (no Qty row in the price box): "GD01-001 (3x)", or each picked
          card with its copies for PB listings, e.g. "GD02-110 (2x), ST05-010 (1x)". */}
      {/* The listing's items / cards: a summary line that unfolds into the full list */}
      {foldList && (
        <button
          type="button"
          aria-expanded={showItems}
          data-testid={`item-list-toggle-${item.id}`}
          onClick={() => setShowItems((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left font-mono text-[0.65rem] leading-relaxed text-slate-300 hover:text-slate-100"
        >
          <span className="min-w-0 truncate">{listSummary}</span>
          <ChevronDown className={`size-3.5 shrink-0 text-slate-500 transition-transform ${showItems ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}

      {/* Bundle of products: what's in it, one line per product (its edition / parts / cards) */}
      {showItems && bundleItems.length > 1 && (
        <div className="space-y-0.5 font-mono text-[0.65rem] leading-relaxed text-slate-300" data-testid={`item-bundle-items-${item.id}`}>
          {bundleItems.map((e, i) => (
            <p key={i} className="line-clamp-2" title={e.detail ? `${e.name} · ${e.detail}` : e.name}>
              {e.code ?? e.name} ({e.quantity}x)
              {e.detail && <span className="text-slate-400"> · {e.detail}</span>}
            </p>
          ))}
        </div>
      )}

      {bundleItems.length <= 1 && (!foldList || showItems) && (
      <p className="font-mono text-[0.65rem] leading-relaxed text-slate-300" data-testid={`item-copies-${item.id}`}>
        {hasCopies
          ? isBundle
            ? `${qtyLabel} · each: ${cardCopies(pickedCards, item.card_quantities)}`
            : cardCopies(pickedCards, item.card_quantities)
          : qtyLabel}
      </p>
      )}

      {!hasCopies && item.alt_art_cards.length > 0 && (
        <p className="font-mono text-[0.65rem] leading-relaxed text-slate-400" data-testid={`item-alt-arts-${item.id}`}>
          {cardNumbers(item.alt_art_cards)}
        </p>
      )}

      {!hasCopies && item.resource_cards.length > 0 && (
        <p className="font-mono text-[0.65rem] leading-relaxed text-slate-400" data-testid={`item-resources-${item.id}`}>
          {item.resource_cards.join(", ")}
        </p>
      )}

      {/* Money + qty */}
      <div className="space-y-1 rounded-md border border-slate-800/60 bg-slate-950/40 px-2 py-1.5">
        {/* Per-item prices: folded away until "Price breakdown" is opened */}
        {hasBreakdown && (
          <button
            type="button"
            aria-expanded={showPrices}
            data-testid={`item-price-toggle-${item.id}`}
            onClick={() => setShowPrices((v) => !v)}
            className="flex w-full items-center justify-between gap-2 font-mono text-[0.65rem] uppercase tracking-wider text-slate-500 hover:text-slate-300"
          >
            Price breakdown
            <ChevronDown className={`size-3.5 transition-transform ${showPrices ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
        {/* Bundle: each product's price (and its cards' prices), then what the rest shares / a discount */}
        {showPrices && bundleItems.length > 1 && (
          <div className="space-y-0.5" data-testid={`item-bundle-prices-${item.id}`}>
            {bundleItems.map((e, i) => {
              const line = bundleLineTotal(e);
              const cards = Object.keys(e.card_prices ?? {}).length + Object.keys(e.part_prices ?? {}).length > 0;
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between gap-2 font-mono text-xs" title={e.detail ? `${e.name} · ${e.detail}` : e.name}>
                    <span className="min-w-0 truncate text-slate-400">
                      {e.code ?? e.name}
                      {e.quantity > 1 && e.price != null && (
                        <span className="text-slate-500">
                          {" "}
                          · {e.quantity} × {formatAud(e.price)}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 tabular-nums ${line == null ? "text-slate-500" : "text-slate-200"}`}>
                      {line == null ? "—" : formatAud(line)}
                    </span>
                  </div>
                  {cards && (
                    <PriceLines
                      lines={priceBreakdown(
                        [...physicalParts(e.parts ?? [], e.part_prices), ...cardParts(e.card_quantities, e.card_prices)],
                        e.price,
                      )}
                      className="border-l border-slate-700 pl-2"
                    />
                  )}
                </div>
              );
            })}
            <PriceLines
              lines={priceBreakdown(
                bundleItems.map((e) => ({ label: e.code ?? e.name, qty: e.quantity, each: e.price })),
                item.price,
              ).filter((l) => l.kind !== "priced")}
            />
          </div>
        )}
        {/* Cards / designs priced one by one (and, in a part bundle, the parts sharing the rest) */}
        {showPrices && bundleItems.length <= 1 && cardPriceParts.length > 0 && (
          <PriceLines lines={priceBreakdown(cardPriceParts, item.price)} />
        )}
        <Detail
          label={
            isSold
              ? "Sold for"
              : bundleItems.length > 1
                ? bundleItems.every((e) => e.price != null) && bundleItems.reduce((s, e) => s + (bundleLineTotal(e) ?? 0), 0).toFixed(2) === item.price.toFixed(2)
                  ? "Total"
                  : "Bundle price"
                : isBundle
                  ? "Per bundle"
                  : "Asking"
          }
        >
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
        {item.status === "for_sale" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${item.name} to storage`}
            title="Move to storage"
            data-testid={`item-hold-${item.id}`}
            onClick={() => actions.onHold(item)}
            className="text-violet-300 hover:text-violet-200"
          >
            <Lock className="size-4" />
          </Button>
        )}
        {(item.status === "pending" || item.status === "on_hold") && (
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
        {/* in storage: only Back to For Sale, Edit and Delete */}
        {!isSold && item.status !== "on_hold" && (
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
