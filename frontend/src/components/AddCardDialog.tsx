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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rarityClass } from "@/components/badges";
import { apiGet } from "@/lib/api";
import { CatalogSyncPanel, useCatalogSync } from "@/components/CatalogSync";
import { COLOR_DOT_CLASS } from "@/lib/format";
import { labelize, type BundleEntry, type CatalogCard, type ItemPayload } from "@/lib/types";
import { ArrowLeft, Layers, Loader2, Minus, Plus, Search } from "lucide-react";
import { BundleBar, bundlePayload } from "@/components/AddItemDialog";
import { HoverZoom } from "@/components/InfoTip";

interface AddCardDialogProps {
  onClose: () => void;
  onSubmit: (payload: ItemPayload) => void;
  onManual: () => void; // fall back to the free-form card form
  pending: boolean;
  // the bundle being built — shared with Add Item, so cards and products can be bundled together
  bundle: BundleEntry[];
  setBundle: (update: (cur: BundleEntry[]) => BundleEntry[]) => void;
  onListBundle: (payload: ItemPayload) => void;
  onAddItem: () => void; // switch to Add Item, keeping the bundle
}

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";

function RarityChip({ rarity }: { rarity: CatalogCard["rarity"] }) {
  if (!rarity) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[0.65rem] font-bold ${rarityClass(rarity)}`}
    >
      {rarity}
    </span>
  );
}

/* ---------------- step 1: search ---------------- */

// A release on the official card list, e.g. { key: "GD01", name: "Newtype Rising", count: 179 }.
interface Release {
  key: string;
  name: string;
  count: number;
}

const ALL_RELEASES = "all";

function CardSearch({ onPick }: { onPick: (card: CatalogCard) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [release, setRelease] = useState(ALL_RELEASES);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const sync = useCatalogSync("cards");
  const hasCatalog = (sync.data?.catalog_count ?? 0) > 0;

  const releases = useQuery({
    queryKey: ["cards", "releases"],
    queryFn: () => apiGet<Release[]>("/cards/releases"),
    enabled: hasCatalog,
    staleTime: 5 * 60_000,
  });

  // A picked release shows all of its cards (up to 400); otherwise the first 48 matches.
  const releaseParam = release === ALL_RELEASES ? "" : `&release=${encodeURIComponent(release)}`;
  const results = useQuery({
    queryKey: ["cards", "search", debounced, release],
    queryFn: () =>
      apiGet<CatalogCard[]>(
        `/cards?limit=${release === ALL_RELEASES ? 48 : 400}&q=${encodeURIComponent(debounced)}${releaseParam}`,
      ),
    enabled: hasCatalog,
    placeholderData: keepPreviousData,
  });

  // "GD01 · Newtype Rising"; releases without a code show just their name ("Edition Beta").
  const releaseLabel = (r: Release) => (r.key === r.name ? r.name : `${r.key} · ${r.name}`);
  const releaseItems = [
    { value: ALL_RELEASES, label: "All releases" },
    ...(releases.data ?? []).map((r) => ({ value: r.key, label: releaseLabel(r) })),
  ];

  if (sync.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-slate-900/60" />;
  }
  if (!hasCatalog) return <CatalogSyncPanel kind="cards" />;

  const cards = results.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <Input
            autoFocus
            data-testid="card-search"
            placeholder="Search card name or number — e.g. Zock, ST11-003"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 bg-slate-950/60 pl-9"
          />
        </div>
        {/* Release filter, like the official card list: GD01, ST01, EB01, Edition Beta, Promotion card … */}
        <Select value={release} onValueChange={(value) => setRelease(value || ALL_RELEASES)} items={releaseItems}>
          <SelectTrigger
            data-testid="card-release-filter"
            aria-label="Filter by release"
            className="h-10 w-full bg-slate-950/60 sm:w-60"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {releaseItems.map((r) => (
              <SelectItem key={r.value} value={r.value} data-testid={`card-release-${r.value}`}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {results.isError ? (
        <p className="text-sm text-red-400">Could not search the card database.</p>
      ) : cards.length === 0 && !results.isFetching ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No cards match{debounced ? ` “${debounced}”` : ""}
          {release === ALL_RELEASES ? "" : ` in ${releaseItems.find((r) => r.value === release)?.label ?? release}`}.
        </p>
      ) : (
        <ul
          data-testid="card-search-results"
          className="grid max-h-[50svh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4"
        >
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                data-testid={`card-result-${card.id}`}
                onClick={() => onPick(card)}
                className="group flex w-full flex-col gap-1.5 rounded-lg border border-slate-800/80 bg-slate-900/60 p-1.5 text-left transition-colors hover:border-sky-500/60 focus-visible:border-sky-500 focus-visible:outline-none"
              >
                <HoverZoom src={card.image_url} alt={card.name} className="block w-full">
                  <img
                    src={card.image_url}
                    alt={card.name}
                    loading="lazy"
                    className="aspect-[63/88] w-full rounded object-cover"
                  />
                </HoverZoom>
                <span className="flex items-center gap-1">
                  <RarityChip rarity={card.rarity} />
                  <span className="truncate font-mono text-[0.65rem] text-slate-400">
                    {card.card_no}
                    {card.parallel > 0 && " ★"}
                  </span>
                </span>
                <span className="line-clamp-2 text-xs leading-tight font-medium text-slate-100">{card.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CatalogSyncPanel kind="cards" compact />
    </div>
  );
}

/* ---------------- step 2: details ---------------- */

function CardDetailsForm({
  card,
  onBack,
  onSubmit,
  onAddToBundle,
  bundleCount,
  pending,
}: {
  card: CatalogCard;
  onBack: () => void;
  onSubmit: (payload: ItemPayload) => void;
  onAddToBundle: (entry: BundleEntry) => void;
  bundleCount: number; // entries already in the bundle being built
  pending: boolean;
}) {
  const [price, setPrice] = useState("");
  const [purchase, setPurchase] = useState("");
  // Copies to sell — set with the − / + on the card image (no Qty box).
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Checked prices; null (with the error shown) if invalid. In a bundle the price is optional
  // (the card can share the bundle's price).
  const readPrices = (allowNoPrice: boolean): { price: number | null; purchase: number | null } | null => {
    const priceNum = price.trim() === "" ? null : Number(price);
    if ((priceNum == null && !allowNoPrice) || (priceNum != null && (Number.isNaN(priceNum) || priceNum < 0))) {
      setError("Enter an asking price of zero or more.");
      return null;
    }
    let purchaseNum: number | null = null;
    if (purchase.trim() !== "") {
      purchaseNum = Number(purchase);
      if (Number.isNaN(purchaseNum) || purchaseNum < 0) {
        setError("Purchase price must be zero or more.");
        return null;
      }
    }
    return { price: priceNum, purchase: purchaseNum };
  };

  const addToBundle = () => {
    const prices = readPrices(true);
    if (!prices) return;
    onAddToBundle({
      name: card.name,
      product_id: null,
      category: null,
      kind: "card",
      code: card.card_no,
      image_url: card.image_url,
      detail: [card.rarity, card.id !== card.card_no ? "Parallel" : null].filter(Boolean).join(" · ") || null,
      quantity,
      price: prices.price,
      purchase_price: prices.purchase,
      card_quantities: {},
      card_prices: {},
      parts: [],
      part_prices: {},
    });
  };

  const submit = () => {
    const prices = readPrices(false);
    if (!prices) return;
    const qtyNum = quantity;
    const priceNum = prices.price as number;
    const purchaseNum = prices.purchase;
    onSubmit({
      kind: "card",
      name: card.name,
      color: card.color,
      card_type: card.card_type,
      rarity: card.rarity,
      category: null,
      card_id: card.id,
      card_no: card.card_no,
      set_code: card.set_code,
      set_name: card.set_name,
      price: priceNum,
      purchase_price: purchaseNum,
      image_url: card.image_url,
      quantity: qtyNum,
      condition: null,
      notes: notes.trim() || null,
    });
  };

  const facts: [string, string | null][] = [
    ["Qty", `${card.card_no} (${quantity}x)`],
    ["Set", card.set_name ? `${card.set_code} · ${card.set_name}` : card.set_code],
    ["Type", card.card_type ? labelize(card.card_type) : null],
    ["Lv / Cost", card.level || card.cost ? `${card.level ?? "-"} / ${card.cost ?? "-"}` : null],
    ["AP / HP", card.ap || card.hp ? `${card.ap ?? "-"} / ${card.hp ?? "-"}` : null],
    ["Trait", card.trait],
  ];

  return (
    <div className="space-y-4" data-testid="card-details-form">
      <div className="flex gap-4">
        <div className="relative w-28 shrink-0 self-start sm:w-36">
          <HoverZoom src={card.image_url} alt={card.name} className="block w-full">
            <img
              src={card.image_url}
              alt={card.name}
              className="aspect-[63/88] w-full rounded-md border border-slate-800 object-cover"
            />
          </HoverZoom>
          {/* − / + always visible on the picked card: how many copies you're selling */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            data-testid="add-card-copies"
          >
            <div className="flex items-center gap-1 rounded-full bg-slate-950/90 p-1 shadow-lg ring-1 ring-slate-600">
              <button
                type="button"
                aria-label={`One fewer copy of ${card.card_no}`}
                data-testid="add-card-copies-minus"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="flex size-7 items-center justify-center rounded-full bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40"
              >
                <Minus className="size-3.5" aria-hidden />
              </button>
              <span className="min-w-6 text-center font-mono text-sm font-semibold text-white" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label={`One more copy of ${card.card_no}`}
                data-testid="add-card-copies-plus"
                disabled={quantity >= 99}
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="flex size-7 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <RarityChip rarity={card.rarity} />
            <span className="font-mono text-xs font-semibold text-slate-300">{card.card_no}</span>
            {card.parallel > 0 && (
              <span className="rounded border border-amber-500/40 px-1 text-[0.65rem] text-amber-300">Parallel</span>
            )}
          </div>
          <p className="font-heading text-lg leading-tight font-bold text-slate-100">{card.name}</p>
          {card.color && (
            <p className="flex items-center gap-1.5 text-sm text-slate-300">
              <span className={`size-2.5 rounded-full ${COLOR_DOT_CLASS[card.color]}`} aria-hidden />
              {labelize(card.color)}
            </p>
          )}
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-card-price" className={LABEL}>
            Asking price (AUD)
          </Label>
          <Input
            id="add-card-price"
            data-testid="add-card-price"
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
          <Label htmlFor="add-card-purchase" className={LABEL}>
            Purchase price (AUD)
          </Label>
          <Input
            id="add-card-purchase"
            data-testid="add-card-purchase-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="What you paid"
            value={purchase}
            onChange={(e) => setPurchase(e.target.value)}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="add-card-notes" className={LABEL}>
            Notes
          </Label>
          <Textarea
            id="add-card-notes"
            data-testid="add-card-notes"
            rows={3}
            placeholder="Anything a buyer should know"
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
        <Button variant="ghost" onClick={onBack} data-testid="add-card-back">
          <ArrowLeft className="size-4" /> Choose another card
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant={bundleCount > 0 ? "outline" : "default"} onClick={submit} disabled={pending} data-testid="add-card-submit">
            {pending && <Loader2 className="size-4 animate-spin" />} Add card
          </Button>
          <Button variant={bundleCount > 0 ? "default" : "outline"} onClick={addToBundle} disabled={pending} data-testid="add-card-add-to-bundle">
            <Layers className="size-4" /> {bundleCount > 0 ? `Add to bundle (${bundleCount + 1})` : "Add to bundle"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

/* ---------------- dialog ---------------- */

export default function AddCardDialog({
  onClose,
  onSubmit,
  onManual,
  pending,
  bundle,
  setBundle,
  onListBundle,
  onAddItem,
}: AddCardDialogProps) {
  const [card, setCard] = useState<CatalogCard | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Pinned near the top so the dialog doesn't jump around as search results change height. */}
      <DialogContent
        className="top-4 max-h-[calc(100svh-2rem)] translate-y-0 overflow-x-hidden overflow-y-auto sm:top-[6svh] sm:max-h-[88svh] sm:max-w-2xl [&>*]:min-w-0"
        data-testid="add-card-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Add Card</DialogTitle>
          <DialogDescription>
            {card
              ? "Set your asking price and details — it will be listed as For Sale."
              : "Search the card database, then pick the card (parallel arts are marked ★)."}
          </DialogDescription>
        </DialogHeader>

        {bundle.length > 0 && (
          <BundleBar
            entries={bundle}
            onRemove={(i) => setBundle((cur) => cur.filter((_, j) => j !== i))}
            onList={(total) => onListBundle(bundlePayload(bundle, total))}
            itemOpen={card ? card.card_no : null}
            pending={pending}
            switchLabel="Add an item"
            onSwitch={onAddItem}
          />
        )}

        {card ? (
          <CardDetailsForm
            key={card.id + bundle.length}
            card={card}
            onBack={() => setCard(null)}
            onSubmit={onSubmit}
            onAddToBundle={(entry) => {
              setBundle((cur) => [...cur, entry]);
              setCard(null); // back to search for the next card
            }}
            bundleCount={bundle.length}
            pending={pending}
          />
        ) : (
          <>
            <CardSearch onPick={setCard} />
            <button
              type="button"
              className="self-start text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              data-testid="add-card-manual"
              onClick={onManual}
            >
              Can’t find it? Enter the card manually
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
