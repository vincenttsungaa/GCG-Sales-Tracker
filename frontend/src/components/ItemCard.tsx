import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "@/lib/useMediaQuery";
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
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FolderInput, FolderMinus, Layers, Package, Lock, Pencil, Tag, Trash2, Undo2, User, X } from "lucide-react";

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
      aria-label={`Select ${ariaName(item)}`}
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

// One picture in a bundle's grid: a card (or your own photo) fills its square from the top so the art
// shows; a product is cut out and centred on the hex backdrop like a single listing.
function BundleThumb({ src, alt }: { src: string; alt: string }) {
  const card = isCardPicture(src);
  const cutout = useCutout(src, !card);
  return (
    <img
      src={cutout && cutout !== "pending" ? cutout : src}
      alt={alt}
      loading="lazy"
      className={`size-full ${
        card ? "object-cover object-top" : "object-contain p-[8%] drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)]"
      } ${cutout === "pending" ? "opacity-0" : ""}`}
    />
  );
}

// A bundle's pictures: a 2×2 grid. Just 1 fills the frame; 2 or 3 keep the grid's square size and sit in
// the middle (3: two on top, one below). 5 or more: 4 at a time, with arrows to page through the rest.
function BundleCollage({ id, pics }: { id: string; pics: { src: string | null | undefined; alt: string }[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(pics.length / 4);
  const from = page * 4;
  const shown = pics.slice(from, from + 4);
  // the arrows only change the picture: they don't open or select the listing
  const turn = (e: MouseEvent, step: number) => {
    e.stopPropagation();
    setPage((p) => Math.min(pages - 1, Math.max(0, p + step)));
  };
  // dark plate set inline: dialogs (an open Stakk) repaint bg-[#…] classes in the panel colour
  const arrow = "absolute top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center border border-white/50 text-white hover:brightness-150 focus-visible:outline-2 focus-visible:outline-sky-400";
  const plate = { backgroundColor: "rgb(20 24 32 / 0.8)" };
  return (
    <div data-testid={`item-photo-${id}`} className="item-photo-backdrop relative aspect-[63/88] overflow-hidden rounded-md border border-slate-800/80">
      <div className="absolute inset-0 flex flex-wrap content-center justify-center gap-0.5">
        {shown.map((e, i) => (
          <div key={from + i} className={shown.length === 1 ? "size-full" : "h-[calc(50%-1px)] w-[calc(50%-1px)] overflow-hidden"}>
            {e.src ? (
              <BundleThumb src={e.src} alt={e.alt} />
            ) : (
              <div className="flex size-full items-center justify-center text-slate-600">
                <Package className="size-6" aria-hidden />
              </div>
            )}
          </div>
        ))}
      </div>
      {pages > 1 && (
        <>
          {page > 0 && (
            <button type="button" className={`${arrow} left-1.5`} style={plate} aria-label="Previous items in this bundle" onClick={(e) => turn(e, -1)} data-testid={`bundle-prev-${id}`}>
              <ChevronLeft className="size-4" />
            </button>
          )}
          {page < pages - 1 && (
            <button type="button" className={`${arrow} right-1.5`} style={plate} aria-label="Next items in this bundle" onClick={(e) => turn(e, 1)} data-testid={`bundle-next-${id}`}>
              <ChevronRight className="size-4" />
            </button>
          )}
          {/* which page: dots along the top, between the status badge and the quantity */}
          <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center gap-1" aria-hidden>
            {Array.from({ length: pages }, (_, i) => (
              <span key={i} className={`size-1.5 rounded-full ${i === page ? "bg-white" : "bg-white/45"}`} />
            ))}
          </div>
          <span className="sr-only" aria-live="polite">
            Showing items {from + 1}–{from + shown.length} of {pics.length}
          </span>
        </>
      )}
    </div>
  );
}

// A single card or a single sleeve design sold as an item (Add Item) — shown full-bleed like a card
// from Add Card instead of floating on the hex backdrop. Returns the picture to show, or null.
const SLEEVE_DESIGN_RE = /\/api\/product-images\/(sleeve0[123]|ev03|evx06|evx12)-sleeves\.svg\?designs=([a-z0-9-]+)$/;
const PART_SLEEVES_RE = /\/api\/product-images\/(pb0[123]-part-sleeves(?:-blue|-green)?)\.svg/;
const CARD_DESIGN_RE = /-sleeves\.svg\?designs=(?:ex[a-z]*-\d|rp-\d|gd\d|st\d)[a-z0-9_-]*$/; // one card picked from a set's contents
// card pictures, a card picked from a set, a cut-out design, or your own uploaded photo (treated as a card)
function isCardPicture(url: string): boolean {
  return url.startsWith("/api/card-images/") || url.startsWith("/cutouts/") || url.startsWith("data:") || CARD_DESIGN_RE.test(url);
}
function flatImage(item: CollectionItem): string | null {
  const url = item.image_url;
  if (item.kind !== "item" || !url || (item.bundle_items ?? []).length > 1) return null;
  if (isCardPicture(url)) return url;
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
  const product = item.kind === "item" && !flat && !(src && isCardPicture(src)); // a bundle of cards shows its first card like a card
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
// Listings that share a product name (sleeves in different designs) need the design in their
// button labels, or a screen reader hears the same "Official Matte Sleeves EX" for each one.
const ariaName = (item: CollectionItem) =>
  (item.sleeve_designs ?? []).length > 0 ? `${item.name} (${(item.sleeve_designs ?? []).join(", ")})` : item.name;

const NAME_FADE = {
  background:
    "linear-gradient(to top, rgba(11,15,23,0.95) 0%, rgba(11,15,23,0.9) 22%, rgba(11,15,23,0.78) 40%, rgba(11,15,23,0.58) 56%, rgba(11,15,23,0.36) 70%, rgba(11,15,23,0.18) 82%, rgba(11,15,23,0.06) 92%, rgba(11,15,23,0) 100%)",
};

// Chips on the name fade: dark like the fade in every theme. Set inline so the light-theme
// panel colour for dialogs (index.css) doesn't turn them white inside an open Stakk folder.
const CHIP_BG = { backgroundColor: "rgb(11 15 23 / 0.6)" };
const CHIP_STAKK = { backgroundColor: "rgb(30 34 42 / 0.85)", borderColor: "var(--rt-amber)" }; // edged in the theme's accent

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
  if (collage) return <BundleCollage id={item.id} pics={collage} />;
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

// "N items" and "Price breakdown" open in a panel over the page instead of growing the card, so the other
// cards in the row keep their size. Computers: under the toggle (above it when there's no room below);
// phones: a sheet from the bottom. Clicking anywhere else, Escape, scrolling the page or × closes it.
function DetailsPanel({ anchor, title, footer, onClose, testId, children }: { anchor: HTMLElement; title: string; footer?: ReactNode; onClose: () => void; testId: string; children: ReactNode }) {
  const phone = useMediaQuery("(max-width: 639px)");
  const ref = useRef<HTMLDivElement>(null);
  // inside an open Stakk (a dialog) it goes into that dialog, so clicks in it don't close the dialog
  const host = (anchor.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (phone || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const below = a.bottom + 6 + h <= window.innerHeight || a.top - 6 - h < 0;
    const top = below ? a.bottom + 6 : a.top - 6 - h;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
    // screen position -> position inside the host (the page, or the dialog and how far it's scrolled)
    const inDialog = host !== document.body;
    const box = (inDialog ? host : document.documentElement).getBoundingClientRect();
    setPos({ left: left - box.left + (inDialog ? host.scrollLeft : 0), top: top - box.top + (inDialog ? host.scrollTop : 0) });
  }, [anchor, host, phone]);
  useEffect(() => {
    ref.current?.focus();
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // close just the panel, not an open Stakk around it
      onClose();
      anchor.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    <>
      {phone && <div className="fixed inset-0 z-[69] bg-black/45" aria-hidden />}
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()} // not a click on the listing (Select mode)
        className={`z-[70] flex flex-col overflow-hidden border border-slate-700 bg-[var(--rt-panel)] text-slate-200 shadow-2xl outline-none ${
          phone ? "fixed inset-x-0 bottom-0 max-h-[70vh] rounded-t-xl" : "absolute max-h-80 w-72 rounded-md"
        }`}
        style={phone ? undefined : { left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      >
        {phone && <span className="mx-auto mt-1.5 h-1 w-9 shrink-0 rounded-full bg-slate-600" aria-hidden />}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-xs font-semibold">
          {title}
          <button type="button" aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-800 px-3 py-2">{footer}</div>}
      </div>
    </>,
    host,
  );
}

export default function ItemCard({ item, ...actions }: ItemCardProps) {
  // The list of items / cards and the per-item price breakdown open in a floating panel (one at a time).
  const [panel, setPanel] = useState<"items" | "prices" | null>(null);
  const itemsToggle = useRef<HTMLButtonElement>(null);
  const pricesToggle = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);
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
  const priceLabel = isSold
    ? "Sold for"
    : bundleItems.length > 1
      ? bundleItems.every((e) => e.price != null) && bundleItems.reduce((s, e) => s + (bundleLineTotal(e) ?? 0), 0).toFixed(2) === item.price.toFixed(2)
        ? "Total"
        : "Bundle price"
      : isBundle
        ? "Per bundle"
        : "Asking";
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
      data-details-open={panel ? "" : undefined}
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
            <div className="min-h-[62px] max-sm:min-h-[82px]">
            {/* name: one line, then "…"; hovering a cut-off name shows all of it */}
            <div className="pointer-events-auto">
              <OverflowTip text={item.name}>
                <h3
                  data-testid={`item-name-${item.id}`}
                  className="line-clamp-1 font-heading text-base leading-tight font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)] max-sm:line-clamp-2"
                >
                  {item.name}
                </h3>
              </OverflowTip>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-[#e2e8f0]">
              {item.color && (
                <span className="flex items-center gap-1" data-testid={`color-badge-${item.color}`}>
                  {/* on the dark fade a white card gets a true white dot (light themes turn the usual grey dark) */}
                  <span className={`size-2 rounded-full ${item.color === "white" ? "bg-white" : COLOR_DOT_CLASS[item.color]}`} aria-hidden />
                  {labelize(item.color)}
                </span>
              )}
              {typeText && <span className="capitalize">{typeText}</span>}
              {item.set_code && item.kind === "card" && (
                <span className="font-mono text-[#cbd5e1]" title={item.set_name ?? undefined}>
                  {item.set_code}
                </span>
              )}
              {/* Stakk name: one line, then "…"; hovering shows the whole name */}
              {actions.stackName?.(item) && (
                <div className="pointer-events-auto max-w-full min-w-0">
                  <OverflowTip text={actions.stackName(item) ?? ""}>
                    <span className="block max-w-full truncate rounded-full border px-2 py-px text-[10px] leading-4 font-medium tracking-wide text-[#f1f5f9]" style={CHIP_STAKK} data-testid={`item-stack-${item.id}`}>
                      {actions.stackName(item)}
                    </span>
                  </OverflowTip>
                </div>
              )}
              {/* parts: one line, then "…"; hovering shows the whole list */}
              {partChip && (
                <div className="pointer-events-auto max-w-full min-w-0">
                  <OverflowTip text={partChip}>
                    <span className="block max-w-full truncate rounded border border-sky-400/60 px-1 text-sky-200" style={CHIP_BG} data-testid={`item-part-${item.id}`}>
                      {partChip}
                    </span>
                  </OverflowTip>
                </div>
              )}
              {item.edition && (
                <span className="rounded border border-amber-400/60 px-1 text-amber-200" style={CHIP_BG} data-testid={`item-edition-${item.id}`}>
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
          ref={itemsToggle}
          aria-expanded={panel === "items"}
          aria-haspopup="dialog"
          data-testid={`item-list-toggle-${item.id}`}
          onClick={() => setPanel((p) => (p === "items" ? null : "items"))}
          className="flex w-full items-center justify-between gap-2 text-left font-mono text-[0.65rem] leading-relaxed text-slate-300 hover:text-slate-100"
        >
          <span className="min-w-0 truncate">{listSummary}</span>
          <ChevronDown className={`size-3.5 shrink-0 text-slate-500 transition-transform ${panel === "items" ? "rotate-180" : ""}`} aria-hidden />
        </button>
      )}
      {panel === "items" && itemsToggle.current && (
        <DetailsPanel
          anchor={itemsToggle.current}
          title={bundleItems.length > 1 ? `${bundleItems.length} items in this bundle` : "Cards in this listing"}
          onClose={closePanel}
          testId={`item-list-panel-${item.id}`}
        >

          {/* Bundle of products: what's in it, one line per product (its edition / parts / cards) */}
          {bundleItems.length > 1 && (
        <div className="divide-y divide-dashed divide-slate-800 font-mono text-xs leading-relaxed text-slate-300" data-testid={`item-bundle-items-${item.id}`}>
          {bundleItems.map((e, i) => (
            <p key={i} className="py-1" title={e.detail ? `${e.name} · ${e.detail}` : e.name}>
              {e.code ?? e.name} ({e.quantity}x)
              {e.detail && <span className="text-slate-400"> · {e.detail}</span>}
            </p>
          ))}
        </div>
      )}

          {/* the list of picked cards / designs (a single one sits in the header instead) */}
          {bundleItems.length <= 1 && (
            <p className="font-mono text-xs leading-relaxed text-slate-300" data-testid={`item-copies-${item.id}`}>
              {copiesText}
            </p>
          )}
        </DetailsPanel>
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
            ref={pricesToggle}
            aria-expanded={panel === "prices"}
            aria-haspopup="dialog"
            data-testid={`item-price-toggle-${item.id}`}
            onClick={() => setPanel((p) => (p === "prices" ? null : "prices"))}
            className="flex w-full items-center justify-between gap-2 text-xs text-slate-500 hover:text-slate-300"
          >
            Price breakdown
            <ChevronDown className={`size-3.5 transition-transform ${panel === "prices" ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
        {panel === "prices" && pricesToggle.current && (
          <DetailsPanel
            anchor={pricesToggle.current}
            title="Price breakdown"
            onClose={closePanel}
            testId={`item-price-panel-${item.id}`}
            footer={
              <Detail label={priceLabel}>
                <span className="font-mono font-semibold tabular-nums text-sky-300">{formatAud(isSold ? saleTotal(item) : item.price)}</span>
              </Detail>
            }
          >
        {/* Bundle: each product's price (and its cards' prices), then what the rest shares / a discount */}
        {bundleItems.length > 1 && (
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
        {bundleItems.length <= 1 && cardPriceParts.length > 0 && (
          <PriceLines lines={priceBreakdown(cardPriceParts, item.price)} />
        )}
          </DetailsPanel>
        )}
        <Detail label={priceLabel}>
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
            aria-label={`Restore ${ariaName(item)} to inventory`}
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
            aria-label={`Move ${ariaName(item)} back to for sale`}
            data-testid={`item-unmark-${item.id}`}
            onClick={() => actions.onUnmark(item)}
          >
            <Undo2 className="size-4" /> For Sale
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 flex-1 bg-emerald-600 font-semibold tracking-wide text-white hover:bg-emerald-500"
            aria-label={`Mark ${ariaName(item)} as sold`}
            data-testid={`item-sell-${item.id}`}
            onClick={() => actions.onSell(item)}
          >
            SOLD
          </Button>
        )}
        <Menu.Root>
          <Menu.Trigger
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 data-[popup-open]:bg-slate-800 data-[popup-open]:text-slate-200"
            aria-label={`More options for ${ariaName(item)}`}
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
          aria-label={`Delete ${ariaName(item)}`}
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
