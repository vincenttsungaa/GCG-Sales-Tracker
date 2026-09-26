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
import {
  cardCopies,
  ITEM_CATEGORIES,
  labelize,
  type CatalogProduct,
  type ItemCategory,
  type ItemPayload,
} from "@/lib/types";
import { ArrowLeft, Check, Loader2, Minus, Plus, Search } from "lucide-react";

interface AddItemDialogProps {
  onClose: () => void;
  onSubmit: (payload: ItemPayload) => void;
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

/* ---------------- step 2: details ---------------- */

function ProductDetailsForm({
  product,
  onBack,
  onSubmit,
  pending,
}: {
  product: CatalogProduct;
  onBack: () => void;
  onSubmit: (payload: ItemPayload) => void;
  pending: boolean;
}) {
  const [price, setPrice] = useState("");
  const [purchase, setPurchase] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  // Products sold in more than one edition (ST01–ST04) must pick one; Regular Version is the default.
  const [edition, setEdition] = useState<string | null>(product.editions[0]?.name ?? null);
  const editionInfo = product.editions.find((e) => e.name === edition);
  // Premium Bandai sets (PB01, PB02): which part is being listed; for Resources, which cards.
  const [part, setPart] = useState<string | null>(null);
  const [resources, setResources] = useState<string[]>([]);
  // PB01 "Alt-Art Cards": which alt-art printings (multi-select, print ids e.g. "ST02-010_p4").
  const [altArts, setAltArts] = useState<string[]>([]);
  const showAltArts = part === "Alt-Art Cards" && product.alt_art_cards.length > 0;
  const toggleAltArt = (id: string) =>
    setAltArts((cur) =>
      cur.includes(id)
        ? cur.filter((c) => c !== id)
        : product.alt_art_cards.map((c) => c.id).filter((c) => c === id || cur.includes(c)),
    );
  const showResources = part === "Resources" && product.resource_cards.length > 0;
  const toggleResource = (cardNo: string) =>
    setResources((cur) =>
      cur.includes(cardNo)
        ? cur.filter((c) => c !== cardNo)
        : product.resource_cards.map((c) => c.card_no).filter((c) => c === cardNo || cur.includes(c)),
    );
  // Copies to sell per picked card (Resources / Alt-Art Cards); a newly picked card starts at 1.
  const [copies, setCopies] = useState<Record<string, number>>({});
  const cardMode = showResources || showAltArts;
  const pickedIds = showResources ? resources : showAltArts ? altArts : [];
  const copiesOf = (id: string) => copies[id] ?? 1;
  const totalCopies = pickedIds.reduce((sum, id) => sum + copiesOf(id), 0);
  const copiesSummary = cardCopies(pickedIds, Object.fromEntries(pickedIds.map((id) => [id, copiesOf(id)])));
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

  const submit = () => {
    const priceNum = Number(price);
    // Card parts: quantity is the total copies across the picked cards (set with + / −).
    const qtyNum = cardMode ? Math.max(totalCopies, 1) : Number(quantity);
    let purchaseNum: number | null = null;
    if (price.trim() === "" || Number.isNaN(priceNum) || priceNum < 0) {
      setError("Enter an asking price of zero or more.");
      return;
    }
    if (purchase.trim() !== "") {
      purchaseNum = Number(purchase);
      if (Number.isNaN(purchaseNum) || purchaseNum < 0) {
        setError("Purchase price must be zero or more.");
        return;
      }
    }
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
      setError("Quantity must be a whole number of 1 or more.");
      return;
    }
    if (product.parts.length > 0 && !part) {
      setError("Choose which part of the set you're listing.");
      return;
    }
    if (showResources && resources.length === 0) {
      setError("Select at least one resource card.");
      return;
    }
    if (showAltArts && altArts.length === 0) {
      setError("Select at least one alt-art card.");
      return;
    }
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
    onSubmit({
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
      card_quantities: cardMode ? Object.fromEntries(pickedIds.map((id) => [id, copiesOf(id)])) : {},
      set_code: product.code,
      set_name: null,
      price: priceNum,
      purchase_price: purchaseNum,
      image_url: resourceImage ?? altArtImage ?? product.image_url,
      quantity: qtyNum,
      condition: null,
      notes: notes.trim() || null,
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
            Part of the set
          </span>
          <div
            role="radiogroup"
            aria-labelledby="add-item-part-label"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid="add-item-part"
          >
            {product.parts.map((p) => {
              const selected = p === part;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`add-item-part-${p.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => {
                    setPart(p);
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
              );
            })}
          </div>
        </div>
      )}

      {showResources && (
        <div className="flex flex-col gap-1.5" data-testid="add-item-resources">
          <div className="flex items-center justify-between gap-2">
            <span className={LABEL}>
              Resource cards <span className="normal-case text-slate-500">({resources.length} selected)</span>
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
              Alt-art cards <span className="normal-case text-slate-500">({altArts.length} selected)</span>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cardMode && pickedIds.length > 0 && (
        <p className="font-mono text-xs text-slate-300" data-testid="add-item-copies-summary">
          {copiesSummary} <span className="text-slate-500">· {totalCopies} total</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-item-price" className={LABEL}>
            Asking price (AUD)
          </Label>
          <Input
            id="add-item-price"
            data-testid="add-item-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
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
        {cardMode ? (
          // Card parts: no Qty box (copies are set per card with + / −) — the cell stays as
          // empty space so the form keeps its spacing.
          <div aria-hidden className="flex flex-col gap-1.5" data-testid="add-item-qty-spacer">
            <span className={`${LABEL} invisible`}>Qty</span>
            <div className="h-9" />
          </div>
        ) : (
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

      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="add-item-back">
          <ArrowLeft className="size-4" /> Choose another item
        </Button>
        <Button onClick={submit} disabled={pending} data-testid="add-item-submit">
          {pending && <Loader2 className="size-4 animate-spin" />} Add item
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ---------------- dialog ---------------- */

export default function AddItemDialog({ onClose, onSubmit, onManual, pending }: AddItemDialogProps) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);

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
              ? "Set your asking price and details — it will be listed as For Sale."
              : "Search the product database (starter decks, accessories, Premium Bandai, other), then pick the item."}
          </DialogDescription>
        </DialogHeader>

        {product ? (
          <ProductDetailsForm product={product} onBack={() => setProduct(null)} onSubmit={onSubmit} pending={pending} />
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
