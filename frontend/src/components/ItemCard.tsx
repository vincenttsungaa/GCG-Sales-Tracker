import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge, bundleKind, categoryClass, rarityClass } from "@/components/badges";
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
import { HoverZoom, OverflowTip } from "@/components/InfoTip";
import { cutoutPhoto } from "@/lib/cutout";
import { Menu } from "@base-ui/react/menu";
import { CalendarDays, ChevronDown, Ellipsis, FolderInput, FolderMinus, Layers, Package, Lock, Pencil, Tag, Trash2, Undo2, User } from "lucide-react";

// rows in the card's ⋯ menu (same look as the Stacks menu)
const menuItem = "flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-slate-800";

export interface ItemActionProps {
  onEdit: (item: CollectionItem) => void;
  onMarkPending: (item: CollectionItem) => void;
  onHold: (item: CollectionItem) => void; // move to storage (kept, not for sale for now)
  onSell: (item: CollectionItem) => void;
  onRestore: (item: CollectionItem) => void;
  onDelete: (item: CollectionItem) => void;
  onUnmark: (item: CollectionItem) => void;
  onStack?: (item: CollectionItem) => void; // "Move to Stakk"
  stackName?: (item: CollectionItem) => string | null; // the stack a listing is in, shown as a chip
  onUnstack?: (item: CollectionItem) => void; // take it out of its stack
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
  "Storage Box", "Sleeves", "Playmat", "Deck Box", "Separator",
  "Sleeves (Blue)", "Sleeves (Green)", "Card Case", "Damage Counter Dice", // PB03
  "Booster Pack", // Edition Beta (ASSEMBLE kit photos are on black, so they keep the dark tile)
]);

// An item's photo with its background removed, so it floats on the tile's graphite hex backdrop.
// "pending" while it's being made; null when the original photo should be used.
export function useCutout(src: string | null | undefined, enabled: boolean): string | null | "pending" {
  const [result, setResult] = useState<{ src: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || !src) return;
    let alive = true;
    cutoutPhoto(src).then((url) => alive && setResult({ src, url }));
    return () => {
      alive = false;
    };
  }, [src, enabled]);
  if (!enabled || !src) return null;
  return result?.src === src ? result.url : "pending";
}

// One product in a bundle's collage, cut out to float on the hex backdrop like a single listing.
function BundleThumb({ src, alt }: { src: string; alt: string }) {
  const cutout = useCutout(src, true);
  return (
    <img
      src={cutout && cutout !== "pending" ? cutout : src}
      alt={alt}
      loading="lazy"
      className={`aspect-square w-full object-contain p-1 drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)] ${cutout === "pending" ? "opacity-0" : ""}`}
    />
  );
}

// A single card or a single sleeve design sold as an item (Add Item) — shown full-bleed like a card
// from Add Card instead of floating on the hex backdrop. Returns the picture to show, or null.
const SLEEVE_DESIGN_RE = /\/api\/product-images\/(sleeve0[123]|ev03|evx06|evx12)-sleeves\.svg\?designs=([a-z0-9-]+)$/;
const PART_SLEEVES_RE = /\/api\/product-images\/(pb0[123]-part-sleeves(?:-blue|-green)?)\.svg/;
const CARD_DESIGN_RE = /-sleeves\.svg\?designs=(?:ex[a-z]*-\d|rp-\d|gd\d|st\d)[a-z0-9_-]*$/; // one card picked from a set's contents
function flatImage(item: CollectionItem): string | null {
  const url = item.image_url;
  if (item.kind !== "item" || !url || (item.bundle_items ?? []).length > 1) return null;
  // card images, a card picked from a set, or a sleeve design picture from Add Item (already cut out)
  if (url.startsWith("/api/card-images/") || url.startsWith("/cutouts/") || CARD_DESIGN_RE.test(url)) return url;
  const sleeve = SLEEVE_DESIGN_RE.exec(url);
  if (sleeve) return `/cutouts/${sleeve[1]}-${sleeve[2]}.webp`;
  const part = PART_SLEEVES_RE.exec(url);
  return part ? `/cutouts/${part[1]}.webp` : null;
}

// A listing's small picture inside a stack folder icon: the same picture as its listing card —
// cards and flat designs full-bleed, products cut out on the hex backdrop (a bundle: its first product).
export function FolderThumb({ item }: { item: CollectionItem }) {
  const flat = flatImage(item);
  const bundle = item.bundle_items ?? [];
  const src = flat ?? (bundle.length > 1 ? bundle[0].image_url : null) ?? item.image_url;
  const product = item.kind === "item" && !flat;
  const cutout = useCutout(src, product && !!src);
  if (!src) return null;
  if (!product) return <img src={src} alt="" loading="lazy" className="size-full object-cover object-top" />;
  return (
    <span className="item-photo-backdrop flex size-full items-center justify-center">
      <img
        src={cutout && cutout !== "pending" ? cutout : src}
        alt=""
        loading="lazy"
        className={`size-full object-contain p-[10%] drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)] ${cutout === "pending" ? "opacity-0" : ""}`}
      />
    </span>
  );
}

// Listings enlarged on hover: a playmat or damage counter part, a set's playmat design
// (…-sleeves.svg?designs=playmat), ST09's damage counter dice or Official Damage Counter Dice (dice01).
// EVX08 (Official Damage Counter Dice - Haro) previews at the 1st Anniversary Set dice size.
const DICE_PREVIEW = { w: 292, h: 178 };
// PB02 sleeves (a landscape photo of both sleeves): a smaller preview than the 520px-wide playmats
const PB02_SLEEVES_PREVIEW = { w: 360, h: 263 };
// Previews trimmed to the dice so they fill that frame (the tiles keep the full photo).
const DICE_PREVIEW_IMAGE: [RegExp, string][] = [
  [/\/evx08\.webp$/, "/cutouts/evx08.webp"],
  [/\/st09-sleeves\.svg\?designs=damage-counter$/, "/cutouts/st09-damage-counter.webp"],
];
const dicePreview = (url: string) => DICE_PREVIEW_IMAGE.find(([re]) => re.test(url))?.[1];
const ZOOM_RE = /^(?:Playmat|Damage Counter Dice) |designs=(?:playmat|damage-counter)$|\/dice01-sleeves\.svg|\/evx06-sleeves\.svg\?designs=/; // + EVX06 sleeves picked together

// A card's own corner radius (≈3 mm on a 63 × 88 mm card). Card pictures get it themselves, with
// no frame behind them: some printings come with square, filled-in corners.
export const CARD_CORNERS = { borderRadius: "4.6% / 3.3%" };

// The dark fade behind a listing's name: eased (many stops) so it melts into the picture with no visible
// top edge, and in fixed colours so it stays dark in the light themes.
const NAME_FADE = {
  background:
    "linear-gradient(to top, rgba(11,15,23,0.95) 0%, rgba(11,15,23,0.9) 22%, rgba(11,15,23,0.78) 40%, rgba(11,15,23,0.58) 56%, rgba(11,15,23,0.36) 70%, rgba(11,15,23,0.18) 82%, rgba(11,15,23,0.06) 92%, rgba(11,15,23,0) 100%)",
};

// Card art in the real card ratio (63 × 88 mm). Falls back to an icon if there is no image.
function CardArt({ item }: { item: CollectionItem }) {
  // PB01/PB02 part photos that can't be cut out cleanly are shown on white instead.
  const whitePart = !!item.part && PART_PHOTO_PARTS.has(item.part);
  const [failedSrc, setFailedSrc] = useState<string | null>(null); // reset when the URL changes
  const failed = failedSrc === item.image_url;
  const [wide, setWide] = useState(false); // a landscape picture (PB02 sleeves) fits instead of filling
  const flat = flatImage(item);
  const showImage = item.image_url && !failed;
  const canCutout = item.kind === "item" && !flat && !!item.image_url;
  const cutout = useCutout(item.image_url, canCutout && !failed);
  const onHex = item.kind === "item" && showImage && cutout !== null; // photo floats on the hex backdrop
  const whiteBackdrop = whitePart && !onHex && !flat;
  const bundle = item.bundle_items ?? [];
  // A bundle of GUNDAM ASSEMBLE kits (e.g. ST04A, PC01A): each kit's own photo, as in Add Item, instead
  // of the mosaic the server builds from the source photos.
  const kitBundle = /\/api\/product-images\/([a-z0-9-]+)-bundle\.svg\?parts=([a-z0-9,-]+)&cards=$/.exec(item.image_url ?? "");
  const kitParts = kitBundle ? kitBundle[2].split(",") : [];
  const kitSlugs = kitParts.length > 0 && kitParts.every((s) => s.startsWith("assemble-")) ? kitParts : null;
  const collage =
    bundle.length > 1
      ? bundle.map((e) => ({ src: e.image_url, alt: e.name }))
      : kitSlugs && kitSlugs.length > 1
        ? kitSlugs.map((s) => ({ src: `/api/product-images/${kitBundle?.[1]}-part-${s}.svg`, alt: s }))
        : null;
  if (collage) {
    // A bundle of products (e.g. ST09 + ST01) or kits: a collage of their pictures (up to 4; "+N" for the rest).
    const shown = collage.length > 4 ? collage.slice(0, 3) : collage;
    return (
      <div
        data-testid={`item-photo-${item.id}`}
        className="item-photo-backdrop grid aspect-[63/88] grid-cols-2 content-center gap-1 overflow-hidden rounded-md border border-slate-800/80 p-1"
      >
        {shown.map((e, i) =>
          e.src ? (
            <BundleThumb key={i} src={e.src} alt={e.alt} />
          ) : (
            <div key={i} className="flex aspect-square items-center justify-center rounded text-slate-600">
              <Package className="size-6" aria-hidden />
            </div>
          ),
        )}
        {collage.length > 4 && (
          <div className="flex aspect-square items-center justify-center rounded font-mono text-sm text-slate-300">
            +{collage.length - 3}
          </div>
        )}
      </div>
    );
  }
  // a product photo on the hex backdrop (or as is, when it has no background to remove)
  const photo = (
    <img
      data-testid={`item-photo-${item.id}`}
      src={onHex && cutout !== "pending" ? (cutout ?? undefined) : (item.image_url ?? undefined)}
      alt={item.name}
      loading="lazy"
      className={`size-full transition-opacity duration-200 ${
        onHex
          ? `object-contain px-[7%] py-[11%] drop-shadow-[0_8px_12px_rgba(0,0,0,0.45)] ${cutout === "pending" ? "opacity-0" : ""}`
          : "object-contain p-1"
      }`}
      onError={() => setFailedSrc(item.image_url)}
    />
  );
  // a card picture (from Add Card, or a single card from Add Item) stands on its own: no frame
  const cardImage = !!showImage && (flat ?? item.image_url ?? "").startsWith("/api/card-images/");
  return (
    <div
      className={
        cardImage
          ? "relative aspect-[63/88]"
          : `relative aspect-[63/88] overflow-hidden rounded-md border border-slate-800/80 ${
              item.kind === "item" && (onHex || !showImage) ? "item-photo-backdrop" : whiteBackdrop && showImage ? "bg-white" : "bg-slate-950/70"
            }`
      }
    >
      {showImage ? (
        item.kind === "card" || flat ? (
          // a card (or a single card / sleeve design from Add Item): full-bleed, enlarged on hover
          <HoverZoom
            src={flat ?? item.image_url ?? ""}
            alt={item.name}
            className="block size-full"
            maxSize={/pb02-part-sleeves/.test(flat ?? item.image_url ?? "") ? PB02_SLEEVES_PREVIEW : undefined}
          >
            <img
              data-testid={`item-photo-${item.id}`}
              src={flat ?? item.image_url ?? undefined}
              alt={item.name}
              loading="lazy"
              className={`size-full ${wide ? "object-contain" : "object-cover"}`}
              style={cardImage ? CARD_CORNERS : undefined}
              onLoad={(e) => setWide(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
              onError={() => setFailedSrc(item.image_url)}
            />
          </HoverZoom>
        ) : ZOOM_RE.test(`${item.part ?? ""} ${item.image_url ?? ""}`) ||
          (item.part === "Storage Box" && item.category === "premium bandai") ||
          item.product_id === "evx08" ? (
          // playmats, damage counters (incl. EVX08) and Premium Bandai storage boxes are enlarged on hover too
          <HoverZoom src={dicePreview(item.image_url ?? "") ?? (onHex && cutout !== "pending" ? cutout : null) ?? item.image_url ?? ""} alt={item.name} className="block size-full" backdrop={!!onHex} maxSize={item.product_id === "evx08" || /designs=damage-counter$/.test(item.image_url ?? "") ? DICE_PREVIEW : undefined}>
            {photo}
          </HoverZoom>
        ) : (
          photo
        )
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-slate-600">
          {item.kind === "card" ? <Layers className="size-8" aria-hidden /> : <Package className="size-8" aria-hidden />}
          <span className="font-mono text-[0.65rem] uppercase tracking-wider">
            {item.kind === "card" ? "No image" : (item.category ?? "Item")}
          </span>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      {/* labels in normal case; only the bundle "Total" stays in capitals */}
      <span className={`shrink-0 text-xs text-slate-500 ${label === "Total" ? "font-mono text-[0.65rem] uppercase tracking-wider" : ""}`}>{label}</span>
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
  // a bundle of one kind of product is of type "Bundle"; of different kinds (or products and cards), "Other"
  const bundleOf = bundleKind(item);
  const bundleEntries = item.bundle_items ?? [];
  const bundleCodes = new Set(bundleEntries.map((e) => e.code));
  // a bundle has no single kind: the label is blank, unless every entry is the same product
  // (e.g. "ST13" for ST13 + ST13); card bundles stay blank
  const sharedCode =
    bundleCodes.size === 1 && !bundleEntries.some((e) => e.kind === "card") ? [...bundleCodes][0] : null;
  const headerText = bundleOf ? (sharedCode ?? "") : null;
  const typeText = item.kind === "card" ? item.card_type : bundleOf ? "bundle" : item.category;
  // Resources / Alt-Art Cards listings with copies per card (PB01, PB02), and sleeve designs
  const pickedCards = [...item.resource_cards, ...item.alt_art_cards, ...(item.sleeve_designs ?? [])];
  const hasCopies = pickedCards.length > 0 && Object.keys(item.card_quantities ?? {}).length > 0;
  const qtyCode = item.card_no ?? item.set_code;
  const qtyLabel = qtyCode ? `${qtyCode} (${item.quantity}x)` : `${item.quantity}x`;
  // Several parts of a set listed together ("Storage Box + Playmat + Resources"): Qty counts bundles,
  // the card copies are what's in each one.
  const isBundle = !!item.part?.includes(" + ");
  // the part chip; ST09's damage counter dice (an Extras pick, not a part) get one too, like
  // the dice of PB03 and Edition Beta
  const partChip = item.part ?? (item.sleeve_designs?.includes("Damage Counter Dice") ? "Damage Counter Dice" : null);
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
  // the copies line ("GD01-001 (3x)", "PB01 · GD02-110 (2x)") — shown once, in the header
  const copiesText = hasCopies
    ? isBundle
      ? `${qtyLabel} · each: ${cardCopies(pickedCards, item.card_quantities)}`
      : cardCopies(pickedCards, item.card_quantities)
    : qtyLabel;
  // header: the code plus the picked card / design, without the listing's own count (the ×N badge
  // on the picture shows that) and without "(1x)"
  const headerLabel =
    headerText ??
    ((hasCopies && !foldList
      ? [qtyCode, isBundle ? `each: ${cardCopies(pickedCards, item.card_quantities)}` : cardCopies(pickedCards, item.card_quantities)]
          .filter(Boolean)
          .join(" · ")
          .replace(/ \(1x\)/g, "")
      : qtyCode) ||
      (item.kind === "card" ? "Card" : "Item"));

  return (
    <article
      data-testid={`item-card-${item.id}`}
      onClick={selectOnClick(item, actions)}
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
            title={item.kind === "card" ? "Card" : labelize(typeText ?? "item")}
            className={`inline-flex size-6 items-center justify-center rounded-md border ${
              item.kind === "card" ? "border-slate-700 text-slate-500" : categoryClass(item)
            }`}
          >
            {item.kind === "card" ? <Layers className="size-3.5" aria-hidden /> : <Package className="size-3.5" aria-hidden />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <OverflowTip text={headerLabel}>
            <span className="block truncate font-mono text-xs font-semibold tracking-wide text-slate-300" data-testid={`item-header-${item.id}`}>
              {headerLabel}
            </span>
          </OverflowTip>
        </div>
        <SelectBox item={item} actions={actions} />
      </div>

      <div className="relative">
        <CardArt item={item} />
        {/* name + colour / type / stack / part / edition on a dark fade along the bottom of the picture (doesn't block the hover zoom) */}
        <div
          className={`pointer-events-none absolute inset-0 overflow-hidden ${item.kind === "card" ? "" : "rounded-md"}`}
          style={item.kind === "card" ? CARD_CORNERS : undefined}
        >
          <div className="absolute inset-x-0 bottom-0 px-2 pt-12 pb-1.5" style={NAME_FADE}>
            {/* room for the name and two rows of tags, so names sit at the same height on every card
                (a card with one row of tags no longer has its name lower) */}
            <div className="min-h-[62px]">
            {/* name: one line, then "…"; hovering a cut-off name shows all of it */}
            <div className="pointer-events-auto">
              <OverflowTip text={item.name}>
                <h3
                  data-testid={`item-name-${item.id}`}
                  className="line-clamp-1 font-heading text-base leading-tight font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]"
                >
                  {item.name}
                </h3>
              </OverflowTip>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-[#e2e8f0]">
              {item.color && (
                <span className="flex items-center gap-1" data-testid={`color-badge-${item.color}`}>
                  <span className={`size-2 rounded-full ${COLOR_DOT_CLASS[item.color]}`} aria-hidden />
                  {labelize(item.color)}
                </span>
              )}
              {typeText && <span className="capitalize">{typeText}</span>}
              {item.set_code && item.kind === "card" && (
                <span className="font-mono text-[#cbd5e1]" title={item.set_name ?? undefined}>
                  {item.set_code}
                </span>
              )}
              {actions.stackName?.(item) && (
                <span className="rounded-full border border-[#4b5563] bg-[#1e222a]/80 px-1.5 text-[#f1f5f9]" data-testid={`item-stack-${item.id}`}>
                  {actions.stackName(item)}
                </span>
              )}
              {/* parts: one line, then "…"; hovering shows the whole list */}
              {partChip && (
                <div className="pointer-events-auto max-w-full min-w-0">
                  <OverflowTip text={partChip}>
                    <span className="block max-w-full truncate rounded border border-sky-400/60 bg-[#0b0f17]/60 px-1 text-sky-200" data-testid={`item-part-${item.id}`}>
                      {partChip}
                    </span>
                  </OverflowTip>
                </div>
              )}
              {item.edition && (
                <span className="rounded border border-amber-400/60 bg-[#0b0f17]/60 px-1 text-amber-200" data-testid={`item-edition-${item.id}`}>
                  {item.edition}
                </span>
              )}
              {item.condition && <span className="text-[#cbd5e1]">{item.condition}</span>}
            </div>
            </div>
          </div>
        </div>
        <div className="absolute top-1.5 left-1.5 drop-shadow">
          <StatusBadge status={item.status} />
        </div>
        {item.quantity > 0 && (
          <span className="absolute top-1.5 right-1.5 rounded-md border border-slate-700 bg-slate-950/90 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-100 drop-shadow">
            ×{item.quantity}
          </span>
        )}
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

      {/* the unfolded list of picked cards / designs (a single one sits in the header instead) */}
      {bundleItems.length <= 1 && foldList && showItems && (
      <p className="font-mono text-[0.65rem] leading-relaxed text-slate-300" data-testid={`item-copies-${item.id}`}>
        {copiesText}
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
            className="flex w-full items-center justify-between gap-2 text-xs text-slate-500 hover:text-slate-300"
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

      {/* Actions: one main button, everything else under ⋯, Delete kept on its own. Pinned to the bottom so tiles in a row line up */}
      <div className="mt-auto flex items-center gap-1.5 border-t border-slate-800/60 pt-2">
        {isSold ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1"
            aria-label={`Restore ${item.name} to inventory`}
            data-testid={`item-restore-${item.id}`}
            onClick={() => actions.onRestore(item)}
          >
            <Undo2 className="size-4" /> Restore
          </Button>
        ) : item.status === "on_hold" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-1"
            aria-label={`Move ${item.name} back to for sale`}
            data-testid={`item-unmark-${item.id}`}
            onClick={() => actions.onUnmark(item)}
          >
            <Undo2 className="size-4" /> For Sale
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 flex-1 bg-emerald-600 font-semibold tracking-wide text-white hover:bg-emerald-500"
            aria-label={`Mark ${item.name} as sold`}
            data-testid={`item-sell-${item.id}`}
            onClick={() => actions.onSell(item)}
          >
            SOLD
          </Button>
        )}
        <Menu.Root>
          <Menu.Trigger
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 data-[popup-open]:bg-slate-800 data-[popup-open]:text-slate-200"
            aria-label={`More options for ${item.name}`}
            title="More options"
            data-testid={`item-menu-${item.id}`}
          >
            <Ellipsis className="size-4" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="z-50 outline-none" align="end" sideOffset={4}>
              <Menu.Popup className="min-w-48 rounded-md border border-slate-700 bg-[#1a2130] p-1 text-slate-200 shadow-lg outline-none">
                {item.status === "for_sale" && (
                  <Menu.Item className={`${menuItem} text-amber-200`} onClick={() => actions.onMarkPending(item)} data-testid={`item-pending-${item.id}`}>
                    <Tag className="size-3.5" /> Mark as Pending
                  </Menu.Item>
                )}
                {item.status === "for_sale" && (
                  <Menu.Item className={`${menuItem} text-violet-300`} onClick={() => actions.onHold(item)} data-testid={`item-hold-${item.id}`}>
                    <Lock className="size-3.5" /> Move to Storage
                  </Menu.Item>
                )}
                {item.status === "pending" && (
                  <Menu.Item className={menuItem} onClick={() => actions.onUnmark(item)} data-testid={`item-unmark-${item.id}`}>
                    <Undo2 className="size-3.5" /> Back to For Sale
                  </Menu.Item>
                )}
                {/* in a stack: take it out; otherwise move it into one */}
                {actions.onUnstack && actions.stackName?.(item) ? (
                  <Menu.Item className={`${menuItem} text-sky-300`} onClick={() => actions.onUnstack?.(item)} data-testid={`item-unstack-${item.id}`}>
                    <FolderMinus className="size-3.5" /> Remove from Stakk
                  </Menu.Item>
                ) : actions.onStack && !isSold && (
                  <Menu.Item className={`${menuItem} text-sky-300`} onClick={() => actions.onStack?.(item)} data-testid={`item-stack-move-${item.id}`}>
                    <FolderInput className="size-3.5" /> Move to Stakk
                  </Menu.Item>
                )}
                <Menu.Item className={menuItem} onClick={() => actions.onEdit(item)} data-testid={`item-edit-${item.id}`}>
                  <Pencil className="size-3.5" /> {isSold ? "Edit sale" : "Edit"}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
