import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CatalogSyncPanel, useCatalogSync } from "@/components/CatalogSync";
import { apiGet } from "@/lib/api";
import { formatAud } from "@/lib/format";
import {
  bundleLineTotal,
  cardCopies,
  CARD_PARTS,
  cardParts,
  ITEM_CATEGORIES,
  physicalParts,
  labelize,
  priceBreakdown,
  pricedTotal,
  type BundleEntry,
  type CatalogProduct,
  type ItemCategory,
  type ItemPayload,
  type PricedPart,
} from "@/lib/types";
import { PriceLines } from "@/components/PriceLines";
import { InfoTip } from "@/components/InfoTip";

// PB01 / PB02: the whole set, unopened (listed on its own, never in a part bundle).
const SEALED = "Sealed";

// Hover tips (the (i) icons) explaining pricing in Add Item.
const TIP_PARTS =
  "Tick one part to list it on its own, or tick several to sell them together as one bundle. In a bundle each part can have its own price (optional) — leave it blank and it shares whatever is left of the bundle's price. \"Sealed\" (the whole set, unopened) is always listed on its own.";
const TIP_CARDS =
  "Pick the cards and set copies with − / +. A price per copy is optional: price every card and you can leave the asking price blank (it becomes their total); price only some and the rest share what's left; no card prices = the usual price per copy.";
const TIP_ASKING =
  "Priced parts / cards add up to the total shown above — leave this blank to use it, or enter your own price: anything left goes to the unpriced items, and a lower price shows as a discount. Optional when adding to a bundle.";
const TIP_ADD_TO_BUNDLE =
  "Puts this item, as set up above, in the bundle, then takes you back to search for the next item. Only items added this way are in the bundle: clicking Add item lists this item on its own instead. When everything is in, list the bundle from the Bundle box at the top.";
const TIP_BUNDLE =
  "Several products listed as one. Leave the bundle price blank to use the total of their prices, or set your own (e.g. a discount). It's needed when an item has no price of its own.";
import { ArrowLeft, Check, Layers, Loader2, Minus, Plus, Search, X } from "lucide-react";

// keepOpen: list the item but leave Add Item open (a bundle is still being built); onDone runs
// once it has been added.
export interface SubmitOptions {
  keepOpen?: boolean;
  onDone?: () => void;
}

interface AddItemDialogProps {
  onClose: () => void;
  onSubmit: (payload: ItemPayload, options?: SubmitOptions) => void;
  onManual: () => void; // fall back to the free-form item form
  pending: boolean;
}

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";

/* ---------------- step 1: search ---------------- */

function ProductSearch({ onPick }: { onPick: (p: CatalogProduct) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<ItemCategory | "all">("all");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const sync = useCatalogSync("products");
  const hasCatalog = (sync.data?.catalog_count ?? 0) > 0;

  const results = useQuery({
    queryKey: ["products", "search", debounced, category],
    queryFn: () =>
      apiGet<CatalogProduct[]>(
        `/products?limit=100&q=${encodeURIComponent(debounced)}${category === "all" ? "" : `&category=${encodeURIComponent(category)}`}`,
      ),
    enabled: hasCatalog,
    placeholderData: keepPreviousData,
  });

  if (sync.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-slate-900/60" />;
  if (!hasCatalog) return <CatalogSyncPanel kind="products" />;

  const products = results.data ?? [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <Input
          autoFocus
          data-testid="product-search"
          placeholder="Search products — e.g. sleeves, PB01, Heavy Dominion"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 bg-slate-950/60 pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="product-category-filter">
        {(["all", ...ITEM_CATEGORIES] as const).map((c) => (
          <Button
            key={c}
            size="xs"
            variant={category === c ? "secondary" : "outline"}
            data-testid={`product-category-${c.replace(/\s+/g, "-")}`}
            onClick={() => setCategory(c)}
          >
            {c === "all" ? "All" : labelize(c)}
          </Button>
        ))}
      </div>

      {results.isError ? (
        <p className="text-sm text-red-400">Could not search the product database.</p>
      ) : products.length === 0 && !results.isFetching ? (
        <p className="py-8 text-center text-sm text-slate-500">No products match{debounced ? ` “${debounced}”` : ""}.</p>
      ) : (
        <ul
          data-testid="product-search-results"
          className="grid max-h-[50svh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
        >
          {products.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                data-testid={`product-result-${p.id}`}
                onClick={() => onPick(p)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-slate-800/80 bg-slate-900/60 p-1.5 text-left transition-colors hover:border-sky-500/60 focus-visible:border-sky-500 focus-visible:outline-none"
              >
                <img
                  src={p.image_url}
                  alt={p.name}
                  loading="lazy"
                  className="aspect-square w-full rounded bg-slate-950 object-contain"
                />
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[0.65rem] text-slate-400">{p.code ?? labelize(p.category)}</span>
                  {p.parts.length > 0 && (
                    <span className="shrink-0 rounded border border-sky-500/40 px-1 text-[0.6rem] text-sky-300">
                      {p.parts.length} parts
                    </span>
                  )}
                  {p.editions.length > 1 && (
                    <span className="shrink-0 rounded border border-amber-500/40 px-1 text-[0.6rem] text-amber-300">
                      {p.editions.length} editions
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-xs leading-tight font-medium text-slate-100">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CatalogSyncPanel kind="products" compact />
    </div>
  );
}

/* ---------------- copies per picked card ---------------- */

// "2x" in the corner of a picked card — always visible.
function CopiesBadge({ count }: { count: number }) {
  return (
    <span className="absolute top-1.5 left-1.5 rounded bg-sky-500 px-1 font-mono text-[0.65rem] font-bold text-white">
      {count}x
    </span>
  );
}

// − / + over the centre of a picked card. Shown on hover (or keyboard focus); always shown on
// touch screens, which have no hover. Sits beside the card's toggle button, not inside it.
function CopyStepper({
  label,
  count,
  testId,
  onChange,
}: {
  label: string;
  count: number;
  testId: string;
  onChange: (delta: number) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-1 top-1 flex aspect-[63/88] items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      data-testid={testId}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-950/90 p-1 shadow-lg ring-1 ring-slate-600">
        <button
          type="button"
          aria-label={`One fewer copy of ${label}`}
          data-testid={`${testId}-minus`}
          onClick={() => onChange(-1)}
          className="flex size-7 items-center justify-center rounded-full bg-slate-800 text-slate-100 hover:bg-slate-700"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="min-w-6 text-center font-mono text-sm font-semibold text-white" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          aria-label={`One more copy of ${label}`}
          data-testid={`${testId}-plus`}
          onClick={() => onChange(1)}
          className="flex size-7 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// Optional price per copy for a picked card / design (blank = no price of its own).
function CardPriceInput({
  label,
  value,
  testId,
  onChange,
}: {
  label: string;
  value: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      placeholder="A$ each"
      aria-label={`Price per copy of ${label} (optional)`}
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 h-7 px-2 text-left font-mono text-xs"
    />
  );
}

/* ---------------- step 2: details ---------------- */

function ProductDetailsForm({
  product,
  onBack,
  onSubmit,
  onAddToBundle,
  onListSolo,
  bundleCount,
  pending,
}: {
  product: CatalogProduct;
  onBack: () => void;
  onSubmit: (payload: ItemPayload) => void;
  onAddToBundle: (entry: BundleEntry) => void; // put this product in the bundle being built
  onListSolo: (payload: ItemPayload) => void; // list it on its own, keeping the bundle
  bundleCount: number; // items already in the bundle being built
  pending: boolean;
}) {
  const [price, setPrice] = useState("");
  const [purchase, setPurchase] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  // Products sold in more than one edition (ST01–ST04) must pick one; Regular Version is the default.
  const [edition, setEdition] = useState<string | null>(product.editions[0]?.name ?? null);
  const editionInfo = product.editions.find((e) => e.name === edition);
  // Sets sold part by part (PB01–PB03, PC01A, PC02A, Edition Beta): which parts are being listed
  // (multi-select, kept in the set's order). One part is listed on its own; two or more are one
  // bundle listing, e.g. "Storage Box + Playmat + Resources".
  const [parts, setParts] = useState<string[]>([]);
  // "Sealed" (PB01 / PB02) is the whole set unopened: it's listed on its own, so ticking it clears
  // the other parts and ticking a part clears it.
  const togglePart = (p: string) =>
    setParts((cur) =>
      cur.includes(p)
        ? cur.filter((x) => x !== p)
        : p === SEALED
          ? [p]
          : product.parts.filter((x) => x !== SEALED && (x === p || cur.includes(x))),
    );
  const isBundle = parts.length > 1;
  const part = parts.length > 0 ? parts.join(" + ") : null;
  // Storage Box / Sleeves / Playmat / Deck Box / Divider …: a single part is listed with its own photo
  // instead of the whole set's box art.
  const partImage = (!isBundle && part && product.part_images[part]) || null;
  const [resources, setResources] = useState<string[]>([]);
  // PB01 "Alt-Art Cards": which alt-art printings (multi-select, print ids e.g. "ST02-010_p4").
  const [altArts, setAltArts] = useState<string[]>([]);
  const showAltArts = parts.includes("Alt-Art Cards") && product.alt_art_cards.length > 0;
  const toggleAltArt = (id: string) =>
    setAltArts((cur) =>
      cur.includes(id)
        ? cur.filter((c) => c !== id)
        : product.alt_art_cards.map((c) => c.id).filter((c) => c === id || cur.includes(c)),
    );
  const showResources = parts.includes("Resources") && product.resource_cards.length > 0;
  const toggleResource = (cardNo: string) =>
    setResources((cur) =>
      cur.includes(cardNo)
        ? cur.filter((c) => c !== cardNo)
        : product.resource_cards.map((c) => c.card_no).filter((c) => c === cardNo || cur.includes(c)),
    );
  // Sleeve products sold in several designs (Official Card Sleeves 01): which designs (multi-select).
  const [sleeves, setSleeves] = useState<string[]>([]);
  const showSleeves = product.sleeve_designs.length > 0;
  const toggleSleeve = (id: string) =>
    setSleeves((cur) =>
      cur.includes(id)
        ? cur.filter((d) => d !== id)
        : product.sleeve_designs.map((d) => d.id).filter((d) => d === id || cur.includes(d)),
    );
  // Copies per picked card (Resources / Alt-Art Cards) or sleeve design; a new pick starts at 1.
  // Listing just cards / designs: quantity is the total copies (set with + / −). In a bundle the
  // copies are what's in each bundle, and Qty is how many bundles.
  const [copies, setCopies] = useState<Record<string, number>>({});
  const hasCardPicks = showResources || showAltArts || showSleeves;
  const cardMode = hasCardPicks && !isBundle;
  const pickedIds = [...(showResources ? resources : []), ...(showAltArts ? altArts : []), ...(showSleeves ? sleeves : [])];
  const copiesOf = (id: string) => copies[id] ?? 1;
  const totalCopies = pickedIds.reduce((sum, id) => sum + copiesOf(id), 0);
  // Sleeve designs are listed by name ("Gundam/EFSF"), cards by number.
  const labelOf = (id: string) => (showSleeves ? (product.sleeve_designs.find((d) => d.id === id)?.name ?? id) : id);
  const pickedCounts = Object.fromEntries(pickedIds.map((id) => [labelOf(id), copiesOf(id)]));
  const copiesSummary = cardCopies(pickedIds.map(labelOf), pickedCounts);
  // Optional price per copy of each picked card / design ("" = no price of its own).
  const [cardPrices, setCardPrices] = useState<Record<string, string>>({});
  const setCardPrice = (id: string, value: string) => setCardPrices((cur) => ({ ...cur, [id]: value }));
  const cardPriceOf = (id: string): number | null => {
    const v = (cardPrices[id] ?? "").trim();
    return v === "" ? null : Number(v);
  };
  // In a part bundle each physical part (storage box, playmat …) can have its own price too.
  const [partPrices, setPartPrices] = useState<Record<string, string>>({});
  const setPartPrice = (p: string, value: string) => setPartPrices((cur) => ({ ...cur, [p]: value }));
  const partPriceOf = (p: string): number | null => {
    const v = (partPrices[p] ?? "").trim();
    return v === "" ? null : Number(v);
  };
  const physicalPicked = isBundle ? parts.filter((p) => !CARD_PARTS.has(p)) : [];
  const isBad = (n: number | null) => n != null && (Number.isNaN(n) || n < 0);
  const badCardPrice = pickedIds.some((id) => isBad(cardPriceOf(id))) || physicalPicked.some((p) => isBad(partPriceOf(p)));
  const anyCardPrice = pickedIds.some((id) => cardPriceOf(id) != null) || physicalPicked.some((p) => partPriceOf(p) != null);
  const priceParts: PricedPart[] = [
    ...physicalPicked.map((p) => ({ label: p, qty: 1, each: badCardPrice ? null : partPriceOf(p) })),
    ...pickedIds.map((id) => ({
      label: labelOf(id).replace(/_p\d+$/, ""),
      qty: copiesOf(id),
      each: badCardPrice ? null : cardPriceOf(id),
    })),
  ];
  const everythingPriced = anyCardPrice && !badCardPrice && priceParts.every((p) => p.each != null);
  // Just cards / designs with prices: the listing is one lot and the asking price is its total.
  const cardLot = cardMode && anyCardPrice;
  const priceEntered = price.trim() !== "";
  const priceTotal =
    priceEntered && !Number.isNaN(Number(price)) ? Number(price) : everythingPriced ? pricedTotal(priceParts) : null;
  const breakdown = anyCardPrice && !badCardPrice ? priceBreakdown(priceParts, priceTotal) : [];
  // + adds a copy; − removes one, and taking the last copy away unpicks the card.
  const changeCopies = (id: string, delta: number, unpick: () => void) => {
    const next = copiesOf(id) + delta;
    if (next < 1) {
      unpick();
      return;
    }
    setCopies((cur) => ({ ...cur, [id]: Math.min(next, 99) }));
  };
  const [error, setError] = useState<string | null>(null);

  // The listing for this product as set up in the form; null (with the error shown) if incomplete.
  // allowNoPrice: for a bundle entry, which may be priced with the bundle as a whole.
  const buildPayload = (allowNoPrice = false): ItemPayload | null => {
    if (badCardPrice) {
      setError("Part and card prices must be zero or more.");
      return null;
    }
    // No asking price typed: use the total of the item prices when everything has one.
    const autoPrice = !priceEntered && everythingPriced;
    const noPrice = !priceEntered && !everythingPriced;
    if (noPrice && !allowNoPrice) {
      setError(
        anyCardPrice
          ? "Enter an asking price, or give every picked item a price."
          : "Enter an asking price of zero or more.",
      );
      return null;
    }
    const priceNum = autoPrice ? pricedTotal(priceParts) : noPrice ? 0 : Number(price);
    // Card parts: quantity is the total copies across the picked cards (set with + / −); a priced
    // lot of cards is one listing.
    const qtyNum = cardLot ? 1 : cardMode ? Math.max(totalCopies, 1) : Number(quantity);
    let purchaseNum: number | null = null;
    if (Number.isNaN(priceNum) || priceNum < 0) {
      setError("Enter an asking price of zero or more.");
      return null;
    }
    if (purchase.trim() !== "") {
      purchaseNum = Number(purchase);
      if (Number.isNaN(purchaseNum) || purchaseNum < 0) {
        setError("Purchase price must be zero or more.");
        return null;
      }
    }
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
      setError("Quantity must be a whole number of 1 or more.");
      return null;
    }
    if (product.parts.length > 0 && parts.length === 0) {
      setError("Choose which part of the set you're listing (pick several to list them as a bundle).");
      return null;
    }
    if (showResources && resources.length === 0) {
      setError("Select at least one resource card.");
      return null;
    }
    if (showAltArts && altArts.length === 0) {
      setError("Select at least one alt-art card.");
      return null;
    }
    if (showSleeves && sleeves.length === 0) {
      setError(product.sleeve_label === "Set contents" ? "Select at least one item from the set." : "Select at least one sleeve design.");
      return null;
    }
    // Bundle: one picture of every picked part's photo and every picked card.
    const bundleParts = parts.filter((p) => product.part_images[p]).map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    const bundleCards = [...(showResources ? resources : []), ...(showAltArts ? altArts : [])];
    const bundleImage =
      isBundle && product.bundle_image_url && bundleParts.length + bundleCards.length > 0
        ? `${product.bundle_image_url}?parts=${bundleParts.join(",")}&cards=${bundleCards.join(",")}`
        : null;
    // Resources: one card → that card's image; several → a picture of just the selected cards.
    const resourceImage = !showResources
      ? null
      : resources.length === 1
        ? (product.resource_cards.find((c) => c.card_no === resources[0])?.image_url ?? null)
        : product.resource_set_image_url
          ? `${product.resource_set_image_url}?cards=${resources.join(",")}`
          : null;
    // Alt-Art Cards: same rule — one card → its image; several → a picture of just those cards.
    const altArtImage = !showAltArts
      ? null
      : altArts.length === 1
        ? (product.alt_art_cards.find((c) => c.id === altArts[0])?.image_url ?? null)
        : product.resource_set_image_url
          ? `${product.resource_set_image_url}?cards=${altArts.join(",")}`
          : null;
    // Sleeve designs: one design → that sleeve; several → a picture of just those sleeves.
    const sleeveImage = !showSleeves
      ? null
      : sleeves.length === 1
        ? (product.sleeve_designs.find((d) => d.id === sleeves[0])?.image_url ?? null)
        : product.sleeve_set_image_url
          ? `${product.sleeve_set_image_url}?designs=${sleeves.join(",")}`
          : null;
    return {
      kind: "item",
      name: product.name,
      color: null,
      card_type: null,
      rarity: null,
      category: product.category,
      product_id: product.id,
      edition,
      part,
      resource_cards: showResources ? resources : [],
      alt_art_cards: showAltArts ? altArts : [],
      sleeve_designs: showSleeves ? sleeves.map(labelOf) : [],
      card_quantities: hasCardPicks ? pickedCounts : {},
      card_prices: Object.fromEntries(
        pickedIds.filter((id) => cardPriceOf(id) != null).map((id) => [labelOf(id), cardPriceOf(id) as number]),
      ),
      part_prices: Object.fromEntries(
        physicalPicked.filter((p) => partPriceOf(p) != null).map((p) => [p, partPriceOf(p) as number]),
      ),
      set_code: product.code,
      set_name: null,
      price: priceNum,
      purchase_price: purchaseNum,
      image_url: bundleImage ?? resourceImage ?? altArtImage ?? sleeveImage ?? partImage ?? product.image_url,
      quantity: qtyNum,
      condition: null,
      notes: notes.trim() || null,
    };
  };

  // With a bundle being built, "Add item" first asks whether this item belongs in the bundle
  // (otherwise it would be listed on its own and the bundle, not yet listed, lost).
  const [askBundle, setAskBundle] = useState(false);
  const submit = () => {
    const payload = buildPayload();
    if (!payload) return;
    if (bundleCount > 0) setAskBundle(true);
    else onSubmit(payload);
  };
  const listSolo = () => {
    const payload = buildPayload();
    if (payload) onListSolo(payload);
  };

  // Bundle entry: the product with its price, and what was picked (part / cards / designs / edition).
  const addToBundle = () => {
    const payload = buildPayload(true);
    if (!payload) return;
    const unpriced = !priceEntered && !everythingPriced;
    const picked = hasCardPicks && pickedIds.length > 0 ? copiesSummary : null;
    const detail = [part, product.editions.length > 1 ? edition : null, picked].filter(Boolean).join(" · ");
    onAddToBundle({
      name: payload.name,
      product_id: product.id,
      category: product.category,
      code: product.code,
      image_url: payload.image_url,
      detail: detail || null,
      quantity: payload.quantity,
      price: unpriced ? null : payload.price,
      purchase_price: payload.purchase_price,
      card_quantities: payload.card_quantities ?? {},
      card_prices: payload.card_prices ?? {},
      parts: physicalPicked,
      part_prices: payload.part_prices ?? {},
    });
  };

  const facts: [string, string | null][] = [
    ["Category", labelize(product.category)],
    ["Code", product.code],
    ["Released", product.release_date],
    ["MSRP", editionInfo?.msrp ? `${editionInfo.msrp} (US)` : product.msrp ? `${product.msrp} (US)` : null],
  ];

  return (
    <div className="space-y-4" data-testid="product-details-form">
      <div className="flex gap-4">
        <img
          src={product.image_url}
          alt={product.name}
          className="aspect-square w-28 shrink-0 rounded-md border border-slate-800 bg-slate-950 object-contain sm:w-36"
        />
        <div className="min-w-0 space-y-2">
          <p className="font-heading text-lg leading-tight font-bold text-slate-100">{product.name}</p>
          <dl className="space-y-0.5 text-xs">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-20 shrink-0 font-mono uppercase text-slate-500">{k}</dt>
                  <dd className="min-w-0 text-slate-300">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {product.editions.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL} id="add-item-edition-label">
            Edition
          </span>
          <div
            role="radiogroup"
            aria-labelledby="add-item-edition-label"
            className="grid grid-cols-2 gap-2"
            data-testid="add-item-edition"
          >
            {product.editions.map((e) => {
              const selected = e.name === edition;
              return (
                <button
                  key={e.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`add-item-edition-${e.name.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => setEdition(e.name)}
                  className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-sky-500 bg-sky-950/50 text-slate-100"
                      : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="text-sm font-medium">{e.name}</span>
                  {e.msrp && <span className="font-mono text-xs text-slate-400">MSRP {e.msrp} (US)</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {product.parts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL} id="add-item-part-label">
            Part of the set{" "}
            <span className="normal-case text-slate-500">
              {isBundle ? `(bundle of ${parts.length})` : "(pick several to list them as a bundle)"}
            </span>{" "}
            <InfoTip label="How parts and bundles are priced">{TIP_PARTS}</InfoTip>
          </span>
          <div
            role="group"
            aria-labelledby="add-item-part-label"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid="add-item-part"
          >
            {product.parts.map((p) => {
              const selected = parts.includes(p);
              // a physical part ticked in a bundle gets its own (optional) price box
              const priced = selected && isBundle && !CARD_PARTS.has(p);
              return (
                <div key={p} className="flex flex-col">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  data-testid={`add-item-part-${p.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => {
                    togglePart(p);
                    setError(null);
                  }}
                  className={`rounded-md border px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                    selected
                      ? "border-sky-500 bg-sky-950/50 text-slate-100"
                      : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {p}
                </button>
                {priced && (
                  <CardPriceInput
                    label={p}
                    value={partPrices[p] ?? ""}
                    testId={`add-item-part-price-${p.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    onChange={(v) => setPartPrice(p, v)}
                  />
                )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showResources && (
        <div className="flex flex-col gap-1.5" data-testid="add-item-resources">
          <div className="flex items-center justify-between gap-2">
            <span className={LABEL}>
              Resource cards <span className="normal-case text-slate-500">({resources.length} selected)</span>{" "}
              <InfoTip label="How card prices work">{TIP_CARDS}</InfoTip>
            </span>
            <span className="flex gap-2">
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                onClick={() => setResources(product.resource_cards.map((c) => c.card_no))}
              >
                Select all
              </Button>
              <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => setResources([])}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {product.resource_cards.map((c) => {
              const selected = resources.includes(c.card_no);
              return (
                <li key={c.card_no} className="group relative">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    data-testid={`add-item-resource-${c.card_no}`}
                    onClick={() => {
                      if (!selected) setCopies((cur) => ({ ...cur, [c.card_no]: 1 }));
                      toggleResource(c.card_no);
                      setError(null);
                    }}
                    className={`relative flex w-full flex-col gap-1 rounded-md border p-1 text-left transition-colors ${
                      selected ? "border-sky-500 bg-sky-950/50" : "border-slate-800 bg-slate-950/40 hover:border-slate-500"
                    }`}
                  >
                    <img
                      src={c.image_url}
                      alt={c.card_no}
                      loading="lazy"
                      className={`aspect-[63/88] w-full rounded object-cover ${selected ? "" : "opacity-60"}`}
                    />
                    <span className="text-center font-mono text-[0.65rem] text-slate-300">{c.card_no}</span>
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-sky-500 text-white">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                    {selected && <CopiesBadge count={copiesOf(c.card_no)} />}
                  </button>
                  {selected && (
                    <CopyStepper
                      label={c.card_no}
                      count={copiesOf(c.card_no)}
                      testId={`add-item-copies-${c.card_no}`}
                      onChange={(delta) => changeCopies(c.card_no, delta, () => toggleResource(c.card_no))}
                    />
                  )}
                  {selected && (
                    <CardPriceInput
                      label={c.card_no}
                      value={cardPrices[c.card_no] ?? ""}
                      testId={`add-item-price-${c.card_no}`}
                      onChange={(v) => setCardPrice(c.card_no, v)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showAltArts && (
        <div className="flex flex-col gap-1.5" data-testid="add-item-alt-arts">
          <div className="flex items-center justify-between gap-2">
            <span className={LABEL}>
              Alt-art cards <span className="normal-case text-slate-500">({altArts.length} selected)</span>{" "}
              <InfoTip label="How card prices work">{TIP_CARDS}</InfoTip>
            </span>
            <span className="flex gap-2">
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                onClick={() => setAltArts(product.alt_art_cards.map((c) => c.id))}
              >
                Select all
              </Button>
              <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => setAltArts([])}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {product.alt_art_cards.map((c) => {
              const selected = altArts.includes(c.id);
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    title={c.name ? `${c.card_no} · ${c.name}` : c.card_no}
                    data-testid={`add-item-alt-art-${c.id}`}
                    onClick={() => {
                      if (!selected) setCopies((cur) => ({ ...cur, [c.id]: 1 }));
                      toggleAltArt(c.id);
                      setError(null);
                    }}
                    className={`relative flex w-full flex-col gap-1 rounded-md border p-1 text-left transition-colors ${
                      selected ? "border-sky-500 bg-sky-950/50" : "border-slate-800 bg-slate-950/40 hover:border-slate-500"
                    }`}
                  >
                    <img
                      src={c.image_url}
                      alt={c.name ?? c.card_no}
                      loading="lazy"
                      className={`aspect-[63/88] w-full rounded object-cover ${selected ? "" : "opacity-60"}`}
                    />
                    <span className="text-center font-mono text-[0.65rem] text-slate-300">{c.card_no}</span>
                    {c.name && <span className="line-clamp-1 text-center text-[0.65rem] text-slate-400">{c.name}</span>}
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-sky-500 text-white">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                    {selected && <CopiesBadge count={copiesOf(c.id)} />}
                  </button>
                  {selected && (
                    <CopyStepper
                      label={c.card_no}
                      count={copiesOf(c.id)}
                      testId={`add-item-copies-${c.id}`}
                      onChange={(delta) => changeCopies(c.id, delta, () => toggleAltArt(c.id))}
                    />
                  )}
                  {selected && (
                    <CardPriceInput
                      label={c.card_no}
                      value={cardPrices[c.id] ?? ""}
                      testId={`add-item-price-${c.id}`}
                      onChange={(v) => setCardPrice(c.id, v)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showSleeves && (
        <div className="flex flex-col gap-1.5" data-testid="add-item-sleeves">
          <div className="flex items-center justify-between gap-2">
            <span className={LABEL}>
              {product.sleeve_label ?? "Sleeve designs"}{" "}
              <span className="normal-case text-slate-500">({sleeves.length} selected)</span>{" "}
              <InfoTip label="How prices work">{TIP_CARDS}</InfoTip>
            </span>
            <span className="flex gap-2">
              <Button
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                onClick={() => setSleeves(product.sleeve_designs.map((d) => d.id))}
              >
                Select all
              </Button>
              <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => setSleeves([])}>
                Clear
              </Button>
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {product.sleeve_designs.map((d) => {
              const selected = sleeves.includes(d.id);
              return (
                <li key={d.id} className="group relative">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    title={d.name}
                    data-testid={`add-item-sleeve-${d.id}`}
                    onClick={() => {
                      if (!selected) setCopies((cur) => ({ ...cur, [d.id]: 1 }));
                      toggleSleeve(d.id);
                      setError(null);
                    }}
                    className={`relative flex w-full flex-col gap-1 rounded-md border p-1 text-left transition-colors ${
                      selected ? "border-sky-500 bg-sky-950/50" : "border-slate-800 bg-slate-950/40 hover:border-slate-500"
                    }`}
                  >
                    <img
                      src={d.image_url}
                      alt={d.name}
                      loading="lazy"
                      className={`aspect-[63/88] w-full rounded ${d.fit === "contain" ? "bg-white object-contain p-0.5" : "object-cover"} ${selected ? "" : "opacity-60"}`}
                    />
                    <span className="line-clamp-1 text-center text-[0.65rem] text-slate-300">{d.name}</span>
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-sky-500 text-white">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                    {selected && <CopiesBadge count={copiesOf(d.id)} />}
                  </button>
                  {selected && (
                    <CopyStepper
                      label={d.name}
                      count={copiesOf(d.id)}
                      testId={`add-item-copies-${d.id}`}
                      onChange={(delta) => changeCopies(d.id, delta, () => toggleSleeve(d.id))}
                    />
                  )}
                  {selected && (
                    <CardPriceInput
                      label={d.name}
                      value={cardPrices[d.id] ?? ""}
                      testId={`add-item-price-${d.id}`}
                      onChange={(v) => setCardPrice(d.id, v)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasCardPicks && pickedIds.length > 0 && (
        <p className="font-mono text-xs text-slate-300" data-testid="add-item-copies-summary">
          {copiesSummary}{" "}
          <span className="text-slate-500">· {totalCopies} {isBundle ? "cards per bundle" : "total"}</span>
        </p>
      )}

      {breakdown.length > 0 && (
        <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2" data-testid="add-item-price-breakdown">
          <PriceLines lines={breakdown} />
          <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 font-mono text-xs">
            <span className="text-slate-300">{isBundle ? "Per bundle" : "Total"}</span>
            <span className="font-semibold tabular-nums text-sky-300">
              {priceTotal == null ? "set an asking price" : formatAud(priceTotal)}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-item-price" className={LABEL}>
            {cardLot ? "Listing price (AUD)" : isBundle ? "Price per bundle (AUD)" : "Asking price (AUD)"}{" "}
            <InfoTip label="How the asking price works">{TIP_ASKING}</InfoTip>
          </Label>
          <Input
            id="add-item-price"
            data-testid="add-item-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder={everythingPriced ? `${pricedTotal(priceParts).toFixed(2)} (total of prices)` : "0.00"}
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {anyCardPrice && (
            <span className="text-[0.7rem] text-slate-500">
              {everythingPriced
                ? "Optional — leave blank to use the total of the prices."
                : "Items without a price share what's left of this price."}
            </span>
          )}
          {!anyCardPrice && <span className="text-[0.7rem] text-slate-500">Optional when adding to a bundle.</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-item-purchase" className={LABEL}>
            Purchase price (AUD)
          </Label>
          <Input
            id="add-item-purchase"
            data-testid="add-item-purchase-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="What you paid"
            value={purchase}
            onChange={(e) => setPurchase(e.target.value)}
          />
        </div>
        {/* Picked cards / designs / set contents set their copies with + / −, so there's no Qty box
            (and no empty space for it): Notes follows the prices directly. */}
        {!cardMode && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-item-qty" className={LABEL}>
              Qty
            </Label>
            <Input
              id="add-item-qty"
              data-testid="add-item-quantity"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        )}
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="add-item-notes" className={LABEL}>
            Notes
          </Label>
          <Textarea
            id="add-item-notes"
            data-testid="add-item-notes"
            rows={3}
            placeholder="e.g. sealed, box has a small dent"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {askBundle && (
        <div
          role="alertdialog"
          aria-labelledby="add-item-ask-bundle"
          className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3"
          data-testid="add-item-ask-bundle"
        >
          <p id="add-item-ask-bundle" className="text-sm text-slate-200">
            You have a bundle in progress ({bundleCount} {bundleCount === 1 ? "item" : "items"}). Should{" "}
            <span className="font-semibold">{product.code ?? product.name}</span> go in the bundle?
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAskBundle(false)} data-testid="add-item-ask-cancel">
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={listSolo} disabled={pending} data-testid="add-item-list-solo">
              {pending && <Loader2 className="size-4 animate-spin" />} List it on its own (keep the bundle)
            </Button>
            <Button size="sm" onClick={addToBundle} disabled={pending} data-testid="add-item-ask-add-to-bundle">
              <Layers className="size-4" /> Add to bundle
            </Button>
          </div>
        </div>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="add-item-back">
          <ArrowLeft className="size-4" /> Choose another item
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {/* Sell several products together, each with its own price (e.g. ST09 + ST01). */}
          <span className="flex items-center justify-center gap-1.5">
            <Button
              variant={bundleCount > 0 ? "default" : "outline"}
              onClick={addToBundle}
              disabled={pending}
              data-testid="add-item-add-to-bundle"
            >
              <Layers className="size-4" /> {bundleCount > 0 ? `Add to bundle (${bundleCount + 1})` : "Add to bundle"}
            </Button>
            <InfoTip label="How Add to bundle works">{TIP_ADD_TO_BUNDLE}</InfoTip>
          </span>
          <Button
            variant={bundleCount > 0 ? "outline" : "default"}
            onClick={submit}
            disabled={pending}
            data-testid="add-item-submit"
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Add item
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

/* ---------------- dialog ---------------- */

/* ---------------- bundle of several products ---------------- */

// Products in a bundle as priced parts (a product without its own price shares the rest).
function bundleParts(entries: BundleEntry[]): PricedPart[] {
  return entries.map((e) => ({ label: e.code ?? e.name, qty: e.quantity, each: e.price }));
}

// One listing for several products, e.g. "Bundle: ST09 + ST01", at the given total price.
function bundlePayload(entries: BundleEntry[], total: number): ItemPayload {
  // one category if they share it (e.g. two starter decks), otherwise "other"
  const categories = new Set(entries.map((e) => e.category ?? "other"));
  const costs = entries.filter((e) => e.purchase_price != null);
  const codes = entries.map((e) => e.code ?? e.name);
  return {
    kind: "item",
    name: `Bundle: ${codes.join(" + ")}`,
    color: null,
    card_type: null,
    rarity: null,
    category: categories.size === 1 ? [...categories][0] : "other",
    product_id: null,
    set_code: entries.every((e) => e.code) ? codes.join(" + ") : null,
    set_name: null,
    bundle_items: entries,
    price: Math.round(total * 100) / 100,
    purchase_price:
      costs.length === entries.length
        ? Math.round(costs.reduce((sum, e) => sum + (e.purchase_price ?? 0) * e.quantity, 0) * 100) / 100
        : null,
    image_url: entries[0]?.image_url ?? null,
    quantity: 1,
    condition: null,
    notes: null,
  };
}

// The cards picked inside a bundle item, with their prices (shown under the item).
function EntryCardLines({ entry }: { entry: BundleEntry }) {
  const priced = Object.keys(entry.card_prices ?? {}).length + Object.keys(entry.part_prices ?? {}).length;
  if (priced === 0) return null;
  const lines = priceBreakdown(
    [...physicalParts(entry.parts ?? [], entry.part_prices), ...cardParts(entry.card_quantities, entry.card_prices)],
    entry.price,
  );
  return <PriceLines lines={lines} className="mt-0.5 border-l border-slate-700 pl-2" />;
}

function BundleBar({
  entries,
  onRemove,
  onList,
  itemOpen,
  pending,
}: {
  entries: BundleEntry[];
  onRemove: (index: number) => void;
  onList: (total: number) => void;
  itemOpen: string | null; // the item being set up below (not in the bundle until added)
  pending: boolean;
}) {
  // Optional price for the whole bundle; blank = the total of the item prices (when all have one).
  const [bundlePrice, setBundlePrice] = useState("");
  const parts = bundleParts(entries);
  const allPriced = parts.every((p) => p.each != null);
  const typed = bundlePrice.trim() !== "" ? Number(bundlePrice) : null;
  const badPrice = typed != null && (Number.isNaN(typed) || typed < 0);
  const total = badPrice ? null : typed ?? (allPriced ? pricedTotal(parts) : null);
  // lines beyond the items themselves: what's shared by unpriced items, or a discount
  const extra = priceBreakdown(parts, total).filter((l) => l.kind !== "priced");
  const canList = entries.length >= 2 && total != null;
  return (
    <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-950/30 p-3" data-testid="add-item-bundle">
      <p className={LABEL}>
        Bundle <span className="normal-case text-slate-500">({entries.length} {entries.length === 1 ? "item" : "items"})</span>
      </p>
      <ul className="space-y-1.5">
        {entries.map((e, i) => {
          const line = bundleLineTotal(e);
          return (
            <li key={i} className="flex items-start gap-2 text-sm" data-testid={`add-item-bundle-entry-${i}`}>
              {e.image_url && (
                <img src={e.image_url} alt="" className="size-9 shrink-0 rounded bg-slate-950 object-contain" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-100">{e.name}</span>
                {e.detail && <span className="block truncate text-xs text-slate-400">{e.detail}</span>}
                <EntryCardLines entry={e} />
              </span>
              <span className="shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-slate-300">
                {line == null ? (
                  <span className="text-slate-500">no price</span>
                ) : (
                  <>
                    {e.quantity > 1 && e.price != null && (
                      <span className="text-slate-500">
                        {e.quantity} × {formatAud(e.price)} ={" "}
                      </span>
                    )}
                    {formatAud(line)}
                  </>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${e.name} from the bundle`}
                onClick={() => onRemove(i)}
                className="text-slate-400 hover:text-red-300"
              >
                <X className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="space-y-2 border-t border-sky-500/20 pt-2">
        <PriceLines lines={extra} />
        <div className="flex items-center justify-between font-mono text-sm">
          <span className="text-slate-300">
            {typed != null ? "Bundle price" : "Total"}
            {typed == null && !allPriced && <span className="text-slate-500"> — some items have no price</span>}
          </span>
          <span className="font-semibold tabular-nums text-sky-300" data-testid="add-item-bundle-total">
            {total == null ? "set a bundle price" : formatAud(total)}
          </span>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="add-item-bundle-price" className={LABEL}>
              Bundle price (AUD){" "}
              <span className="normal-case text-slate-500">
                {allPriced ? "— optional, e.g. for a discount" : "— needed: some items have no price"}
              </span>{" "}
              <InfoTip label="How the bundle price works">{TIP_BUNDLE}</InfoTip>
            </Label>
            <Input
              id="add-item-bundle-price"
              data-testid="add-item-bundle-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder={allPriced ? `${pricedTotal(parts).toFixed(2)} (total of prices)` : "0.00"}
              value={bundlePrice}
              onChange={(ev) => setBundlePrice(ev.target.value)}
              className="h-8"
            />
          </div>
          <Button
            size="sm"
            className="h-8"
            onClick={() => total != null && onList(total)}
            disabled={pending || !canList}
            data-testid="add-item-list-bundle"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {entries.length < 2 ? "Add another item" : `List bundle (${entries.length})`}
          </Button>
        </div>
      </div>
      {itemOpen && (
        <p className="text-xs text-amber-300/90" data-testid="add-item-bundle-hint">
          {itemOpen} isn’t in the bundle yet — click Add to bundle below to include it.
        </p>
      )}
    </div>
  );
}

/* ---------------- dialog ---------------- */

export default function AddItemDialog({ onClose, onSubmit, onManual, pending }: AddItemDialogProps) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  // Products put in a bundle so far (each with its price); listed together as one item.
  const [bundle, setBundle] = useState<BundleEntry[]>([]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Pinned near the top so the dialog doesn't jump around as search results change height. */}
      <DialogContent
        className="top-4 max-h-[calc(100svh-2rem)] translate-y-0 overflow-y-auto sm:top-[6svh] sm:max-h-[88svh] sm:max-w-2xl"
        data-testid="add-item-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Add Item</DialogTitle>
          <DialogDescription>
            {product
              ? "Set your asking price and details — add it on its own, or add it to a bundle with other items."
              : bundle.length > 0
                ? "Pick the next item for the bundle, or list the bundle."
                : "Search the product database (starter decks, accessories, Premium Bandai, other), then pick the item."}
          </DialogDescription>
        </DialogHeader>

        {bundle.length > 0 && (
          <BundleBar
            entries={bundle}
            onRemove={(i) => setBundle((cur) => cur.filter((_, j) => j !== i))}
            onList={(total) => onSubmit(bundlePayload(bundle, total))}
            itemOpen={product ? (product.code ?? product.name) : null}
            pending={pending}
          />
        )}

        {product ? (
          <ProductDetailsForm
            key={product.id + bundle.length}
            product={product}
            onBack={() => setProduct(null)}
            onSubmit={onSubmit}
            onAddToBundle={(entry) => {
              setBundle((cur) => [...cur, entry]);
              setProduct(null); // back to search for the next product
            }}
            // listed on its own while a bundle is being built: keep Add Item (and the bundle)
            // open and go back to search
            onListSolo={(payload) => onSubmit(payload, { keepOpen: true, onDone: () => setProduct(null) })}
            bundleCount={bundle.length}
            pending={pending}
          />
        ) : (
          <>
            <ProductSearch onPick={setProduct} />
            <button
              type="button"
              className="self-start text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              data-testid="add-item-manual"
              onClick={onManual}
            >
              Can’t find it? Enter the item manually
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
