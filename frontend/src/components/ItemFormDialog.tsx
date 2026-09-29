import { useEffect, useState } from "react";
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
import {
  CARD_TYPES,
  GUNDAM_COLORS,
  ITEM_CATEGORIES,
  RARITIES,
  labelize,
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

  // Re-seed the fields whenever the dialog is opened for a different target.
  useEffect(() => {
    setError(null);
  }, [state]);

  const handleSubmit = () => {
    const priceNum = Number(price || 0);
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
      setError("Price must be zero or more.");
      return;
    }
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
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
        bundle_items: editing ? state.item.bundle_items : [],
        card_prices: editing ? state.item.card_prices : {},
        part_prices: editing ? state.item.part_prices : {},
        card_quantities: editing ? state.item.card_quantities : {},
        price: priceNum,
        purchase_price: purchaseNum,
        image_url: imageUrl.trim() || null,
        quantity: qtyNum,
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
            {kind === "card"
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
                  <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Color</Label>
                  <Select value={color} onValueChange={(v: string) => setColor(v as GundamColor)}>
                    <SelectTrigger data-testid="item-form-color">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GUNDAM_COLORS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {titleCase(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Type</Label>
                  <Select value={cardType} onValueChange={(v: string) => setCardType(v as CardType)}>
                    <SelectTrigger data-testid="item-form-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CARD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {labelize(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Rarity</Label>
                  <Select value={rarity} onValueChange={(v: string) => setRarity(v as Rarity)}>
                    <SelectTrigger data-testid="item-form-rarity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RARITIES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">Category</Label>
                <Select value={category} onValueChange={(v: string) => setCategory(v as ItemCategory)}>
                  <SelectTrigger data-testid="item-form-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {labelize(c)}
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
            {/* Condition isn't asked when adding — only shown to edit an existing entry's value. */}
            {editing && (
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
