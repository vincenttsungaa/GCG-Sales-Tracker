import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PriceLines } from "@/components/PriceLines";
import { formatAud } from "@/lib/format";
import {
  CARD_TYPES,
  GUNDAM_COLORS,
  ITEM_CATEGORIES,
  RARITIES,
  labelize,
  priceBreakdown,
  pricedTotal,
  type CardType,
  type CollectionItem,
  type GundamColor,
  type ItemCategory,
  type ItemKind,
  type ItemPayload,
  type Rarity,
} from "@/lib/types";

export type FormState =
  | { type: "add"; kind: ItemKind }
  | { type: "edit"; item: CollectionItem };

interface ItemFormDialogProps {
  state: FormState;
  onClose: () => void;
  onSubmit: (payload: ItemPayload, id?: string) => void;
  pending: boolean;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Select options as {value, label}: passed to <Select items> so the closed select shows the label.
// "none" is a card saved without that field (manual entries, older listings).
const NONE = { value: "none", label: "None" };
const COLOR_ITEMS = [...GUNDAM_COLORS.map((c) => ({ value: c, label: titleCase(c) })), NONE];
const TYPE_ITEMS = [...CARD_TYPES.map((t) => ({ value: t, label: labelize(t) })), NONE];
const RARITY_ITEMS = [...RARITIES.map((r) => ({ value: r, label: r })), NONE];
const CATEGORY_ITEMS = ITEM_CATEGORIES.map((c) => ({ value: c, label: labelize(c) }));

export default function ItemFormDialog({ state, onClose, onSubmit, pending }: ItemFormDialogProps) {
  const editing = state.type === "edit";
  // Cards / items picked from the card or product database keep their name / color / type / rarity from the catalog.
  const copiesLocked = state.type === "edit" && Object.keys(state.item.card_quantities ?? {}).length > 0;
  const fromCatalog = state.type === "edit" && (!!state.item.card_id || !!state.item.product_id);
  const [kind] = useState<ItemKind>(editing ? state.item.kind : state.kind);
  const [name, setName] = useState(editing ? state.item.name : "");
  const [color, setColor] = useState<GundamColor | "none">(editing ? (state.item.color ?? "none") : "white");
  const [cardType, setCardType] = useState<CardType | "none">(editing ? (state.item.card_type ?? "none") : "unit");
  const [rarity, setRarity] = useState<Rarity | "none">(editing ? (state.item.rarity ?? "none") : "C");
  const [category, setCategory] = useState<ItemCategory>(editing ? (state.item.category ?? "other") : "other");
  const [price, setPrice] = useState(String(editing ? state.item.price : ""));
  const [purchase, setPurchase] = useState(
    editing && state.item.purchase_price != null ? String(state.item.purchase_price) : "",
  );
  const [imageUrl, setImageUrl] = useState(editing ? (state.item.image_url ?? "") : "");
  const [quantity, setQuantity] = useState(String(editing ? state.item.quantity : 1));
  const [condition, setCondition] = useState(editing ? (state.item.condition ?? "") : "");
  const [notes, setNotes] = useState(editing ? (state.item.notes ?? "") : "");
  const [error, setError] = useState<string | null>(null);

  // What's inside, each with its own optional price: the products / cards of a bundle, or the
  // picked cards of a priced lot. Blank = no price of its own (shares the rest of the listing price).
  const entries = editing ? (state.item.bundle_items ?? []) : [];
  const bundled = entries.length > 1;
  const lotCards = editing && !bundled && Object.keys(state.item.card_prices ?? {}).length > 0 ? state.item.card_quantities ?? {} : {};
  const insideKeys = bundled ? entries.map((_, i) => String(i)) : Object.keys(lotCards);
  const [inside, setInside] = useState<Record<string, string>>(() => {
    if (!editing) return {};
    const out: Record<string, string> = {};
    if (bundled) entries.forEach((e, i) => (out[i] = e.price == null ? "" : String(e.price)));
    else for (const k of Object.keys(lotCards)) out[k] = state.item.card_prices?.[k] == null ? "" : String(state.item.card_prices[k]);
    return out;
  });
  const insideNum = (k: string) => (inside[k]?.trim() ? Number(inside[k]) : null);
  // a bundle's products / cards also keep what was paid for each (per unit)
  const [paid, setPaid] = useState<Record<string, string>>(() =>
    Object.fromEntries(entries.map((e, i) => [String(i), e.purchase_price == null ? "" : String(e.purchase_price)])),
  );
  const paidNum = (k: string) => (paid[k]?.trim() ? Number(paid[k]) : null);
  // …and how many of each (a product with picked cards keeps the count its picks give it)
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(entries.map((e, i) => [String(i), String(e.quantity)])),
  );
  const qtyLocked = (i: number) => Object.keys(entries[i].card_quantities ?? {}).length > 0;
  const entryQty = (i: number) => (qtyLocked(i) ? entries[i].quantity : Number(qtys[String(i)] || 0));
  const badQty = bundled && entries.some((_, i) => !Number.isInteger(entryQty(i)) || entryQty(i) < 1);
  const badPaid = bundled && entries.some((_, i) => {
    const n = paidNum(String(i));
    return n != null && (Number.isNaN(n) || n < 0);
  });
  const badInside = insideKeys.some((k) => {
    const n = insideNum(k);
    return n != null && (Number.isNaN(n) || n < 0);
  });
  // "RP-025 · Resource", "[ST01] Heroic Beginnings" — the code in front unless the name has it
  const entryName = (i: number) => {
    const { code, name } = entries[i];
    return code && !name.includes(code) ? `${code} · ${name}` : name;
  };
  const insideParts = insideKeys.map((k, i) =>
    bundled
      ? { label: entries[i].code ?? entries[i].name, qty: badQty ? entries[i].quantity : entryQty(i), each: badInside ? null : insideNum(k) }
      : { label: k.replace(/_p\d+$/, ""), qty: lotCards[k], each: badInside ? null : insideNum(k) },
  );
  const allInsidePriced = insideParts.length > 0 && insideParts.every((p) => p.each != null);
  const priceNow = price.trim() === "" || Number.isNaN(Number(price)) ? null : Number(price);
  const insideLines = priceBreakdown(insideParts, priceNow).filter((l) => l.kind !== "priced");

  const handleSubmit = () => {
    // a blank price is "not entered", never A$0
    const priceNum = price.trim() === "" ? Number.NaN : Number(price);
    const qtyNum = Number(quantity || 0);
    let purchaseNum: number | null = null;
    if (purchase.trim() !== "") {
      purchaseNum = Number(purchase);
      if (Number.isNaN(purchaseNum) || purchaseNum < 0) {
        setError("Purchase price must be zero or more.");
        return;
      }
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (Number.isNaN(priceNum) || priceNum < 0) {
      setError("Enter a price of zero or more.");
      return;
    }
    if (badQty) {
      setError("Each quantity inside the bundle must be a whole number of 1 or more.");
      return;
    }
    if (badInside || badPaid) {
      setError("Prices inside the bundle must be zero or more (or blank).");
      return;
    }
    // a bundle's cost is what was paid for all of it — known once every product / card has one
    const bundleCost = entries.every((_, i) => paidNum(String(i)) != null)
      ? Math.round(entries.reduce((sum, _, i) => sum + (paidNum(String(i)) ?? 0) * entryQty(i), 0) * 100) / 100
      : null;
    if (!bundled && (!Number.isInteger(qtyNum) || qtyNum < 1)) {
      setError("Quantity must be a whole number of 1 or more.");
      return;
    }
    onSubmit(
      {
        kind,
        name: name.trim(),
        color: kind === "card" && color !== "none" ? color : null,
        card_type: kind === "card" && cardType !== "none" ? cardType : null,
        rarity: kind === "card" && rarity !== "none" ? rarity : null,
        category: kind === "item" ? category : null,
        // Keep the card-database link when editing a card picked from the catalog.
        card_id: editing ? state.item.card_id : null,
        card_no: editing ? state.item.card_no : null,
        set_code: editing ? state.item.set_code : null,
        set_name: editing ? state.item.set_name : null,
        product_id: editing ? state.item.product_id : null,
        edition: editing ? state.item.edition : null,
        part: editing ? state.item.part : null,
        resource_cards: editing ? state.item.resource_cards : [],
        alt_art_cards: editing ? state.item.alt_art_cards : [],
        sleeve_designs: editing ? state.item.sleeve_designs : [],
        bundle_items: bundled
          ? entries.map((e, i) => ({ ...e, quantity: entryQty(i), price: insideNum(String(i)), purchase_price: paidNum(String(i)) }))
          : editing
            ? state.item.bundle_items
            : [],
        card_prices: Object.keys(lotCards).length
          ? Object.fromEntries(Object.keys(lotCards).flatMap((k) => (insideNum(k) == null ? [] : [[k, insideNum(k) as number]])))
          : editing
            ? state.item.card_prices
            : {},
        part_prices: editing ? state.item.part_prices : {},
        card_quantities: editing ? state.item.card_quantities : {},
        price: priceNum,
        purchase_price: bundled ? bundleCost : purchaseNum,
        image_url: imageUrl.trim() || null,
        quantity: bundled ? 1 : qtyNum, // a bundle is one listing; its counts are per item inside
        condition: condition.trim() || null,
        notes: notes.trim() || null,
      },
      editing ? state.item.id : undefined,
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg" data-testid="item-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">
            {editing ? "Edit" : "Add"} {titleCase(kind)}
          </DialogTitle>
          <DialogDescription>
            {bundled
              ? "Set the asking price, and the price and cost of each product / card inside the bundle."
              : kind === "card"
              ? "Record a Gundam card with its color, type and rarity."
              : "Record a general item — sleeves, playmats, kits, sealed product."}
          </DialogDescription>
        </DialogHeader>

        <div data-testid="item-form" className="grid gap-4">
          {fromCatalog && editing ? (
            <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-2" data-testid="item-form-catalog-card">
              {state.item.image_url && (
                <img src={state.item.image_url} alt="" className={`w-14 rounded ${state.item.kind === "card" ? "aspect-[63/88] object-cover" : "aspect-square bg-slate-950 object-contain"}`} />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-medium text-slate-100">{state.item.name}</p>
                <p className="font-mono text-xs text-slate-400">
                  {[state.item.card_no, state.item.rarity, state.item.color, state.item.card_type, state.item.category, state.item.set_code, state.item.part, state.item.edition]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="item-form-name">Name</Label>
              <Input
                id="item-form-name"
                data-testid="item-form-name"
                placeholder={kind === "card" ? "e.g. MSN-04 Sazabi" : "e.g. Playmat — Strike Freedom"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {kind === "card" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-form-color" className="font-mono text-xs uppercase tracking-wider text-slate-400">Color</Label>
                  <Select value={color} onValueChange={(v: string) => setColor(v as GundamColor)} items={COLOR_ITEMS}>
                    <SelectTrigger id="item-form-color" data-testid="item-form-color">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_ITEMS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-form-type" className="font-mono text-xs uppercase tracking-wider text-slate-400">Type</Label>
                  <Select value={cardType} onValueChange={(v: string) => setCardType(v as CardType)} items={TYPE_ITEMS}>
                    <SelectTrigger id="item-form-type" data-testid="item-form-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_ITEMS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="item-form-rarity" className="font-mono text-xs uppercase tracking-wider text-slate-400">Rarity</Label>
                  <Select value={rarity} onValueChange={(v: string) => setRarity(v as Rarity)} items={RARITY_ITEMS}>
                    <SelectTrigger id="item-form-rarity" data-testid="item-form-rarity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RARITY_ITEMS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : bundled ? null : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-form-category" className="font-mono text-xs uppercase tracking-wider text-slate-400">Category</Label>
                <Select value={category} onValueChange={(v: string) => setCategory(v as ItemCategory)} items={CATEGORY_ITEMS}>
                  <SelectTrigger id="item-form-category" data-testid="item-form-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ITEMS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-form-price" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Asking price (AUD)
              </Label>
              <Input
                id="item-form-price"
                data-testid="item-form-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            {/* a bundle's cost comes from what was paid for each product / card (below) */}
            {!bundled && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-form-purchase-price" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Purchase price (AUD)
              </Label>
              <Input
                id="item-form-purchase-price"
                data-testid="item-form-purchase-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="What you paid"
                value={purchase}
                onChange={(e) => setPurchase(e.target.value)}
              />
            </div>
            )}
            {!bundled && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-form-quantity" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Qty
              </Label>
              <Input
                id="item-form-quantity"
                data-testid="item-form-quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                // Card listings with copies per card: the total comes from those copies.
                disabled={copiesLocked}
                title={copiesLocked ? "Total of the copies per card" : undefined}
              />
            </div>
            )}
            {insideKeys.length > 0 && (
              <div className="col-span-2 space-y-2 rounded-md border border-slate-800 bg-slate-950/40 p-3" data-testid="item-form-inside">
                <p className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Prices inside {bundled ? "the bundle" : "the lot"}{" "}
                  <span className="normal-case text-slate-500">— per unit; a blank price shares the rest of the asking price</span>
                </p>
                <div className="flex gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <span className="flex-1" />
                  {bundled && <span className="w-16">Qty</span>}
                  <span className="w-24">Price</span>
                  {bundled && <span className="w-24">Paid</span>}
                </div>
                {insideKeys.map((k, i) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 text-slate-200" title={bundled ? entryName(i) : k}>
                      <span className="block truncate">
                        {bundled ? entryName(i) : insideParts[i].label}
                        {!bundled && insideParts[i].qty > 1 && <span className="text-slate-500"> ×{insideParts[i].qty}</span>}
                      </span>
                      {bundled && entries[i].detail && (
                        <span className="block truncate text-xs text-slate-500">{entries[i].detail}</span>
                      )}
                    </span>
                    {bundled && (
                      <Input
                        aria-label={`How many ${entryName(i)}`}
                        data-testid={`item-form-inside-qty-${i}`}
                        type="number"
                        min="1"
                        step="1"
                        value={qtyLocked(i) ? String(entries[i].quantity) : (qtys[k] ?? "")}
                        onChange={(e) => setQtys((cur) => ({ ...cur, [k]: e.target.value }))}
                        disabled={qtyLocked(i)}
                        title={qtyLocked(i) ? "Set by the cards picked in it" : undefined}
                        className="w-16"
                      />
                    )}
                    <Input
                      aria-label={`Price of ${bundled ? entryName(i) : insideParts[i].label}`}
                      data-testid={`item-form-inside-price-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="no price"
                      value={inside[k] ?? ""}
                      onChange={(e) => setInside((cur) => ({ ...cur, [k]: e.target.value }))}
                      className="w-24"
                    />
                    {bundled && (
                      <Input
                        aria-label={`What you paid for ${entryName(i)}`}
                        data-testid={`item-form-inside-paid-${i}`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="—"
                        value={paid[k] ?? ""}
                        onChange={(e) => setPaid((cur) => ({ ...cur, [k]: e.target.value }))}
                        className="w-24"
                      />
                    )}
                  </div>
                ))}
                <PriceLines lines={insideLines} />
                {allInsidePriced && pricedTotal(insideParts) !== priceNow && (
                  <Button
                    type="button"
                    size="xs"
                    variant="link"
                    className="h-auto px-0 text-xs"
                    data-testid="item-form-inside-use-total"
                    onClick={() => setPrice(String(pricedTotal(insideParts)))}
                  >
                    Set the asking price to their total ({formatAud(pricedTotal(insideParts))})
                  </Button>
                )}
              </div>
            )}
            {/* Condition isn't asked when adding — only shown to edit an existing entry's value. */}
            {editing && !bundled && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-form-condition" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Condition
                </Label>
                <Input
                  id="item-form-condition"
                  data-testid="item-form-condition"
                  placeholder="e.g. Mint"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                />
              </div>
            )}
          </div>

          {!bundled && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-form-image-url" className="font-mono text-xs uppercase tracking-wider text-slate-400">
              Photo URL (optional)
            </Label>
            <Input
              id="item-form-image-url"
              data-testid="item-form-image-url"
              placeholder="https://…"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-form-notes" className="font-mono text-xs uppercase tracking-wider text-slate-400">
              Notes
            </Label>
            <Textarea
              id="item-form-notes"
              data-testid="item-form-notes"
              placeholder="Storage, wear, provenance…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {error && (
            <p data-testid="item-form-error" className="text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" data-testid="item-form-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="item-form-submit" onClick={handleSubmit} disabled={pending}>
            {editing ? "Save changes" : `Add ${kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
