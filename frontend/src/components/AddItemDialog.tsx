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
import { ITEM_CATEGORIES, labelize, type CatalogProduct, type ItemCategory, type ItemPayload } from "@/lib/types";
import { ArrowLeft, Loader2, Search } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const priceNum = Number(price);
    const qtyNum = Number(quantity);
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
    onSubmit({
      kind: "item",
      name: product.name,
      color: null,
      card_type: null,
      rarity: null,
      category: product.category,
      product_id: product.id,
      set_code: product.code,
      set_name: null,
      price: priceNum,
      purchase_price: purchaseNum,
      image_url: product.image_url,
      quantity: qtyNum,
      condition: null,
      notes: notes.trim() || null,
    });
  };

  const facts: [string, string | null][] = [
    ["Category", labelize(product.category)],
    ["Code", product.code],
    ["Released", product.release_date],
    ["MSRP", product.msrp ? `${product.msrp} (US)` : null],
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
