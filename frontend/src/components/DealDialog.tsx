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
import { formatAud } from "@/lib/format";
import type { CollectionItem, StatusPayload } from "@/lib/types";

export interface DealState {
  item: CollectionItem;
  target: "pending" | "sold";
}

interface DealDialogProps {
  state: DealState;
  today?: string;
  onClose: () => void;
  onConfirm: (payload: StatusPayload, target: "pending" | "sold") => void;
  pending: boolean;
}

export default function DealDialog({ state, today, onClose, onConfirm, pending }: DealDialogProps) {
  const { item, target } = state;
  const [buyer, setBuyer] = useState(item.buyer_name ?? "");
  const [dealDate, setDealDate] = useState(item.deal_date ?? today ?? "");
  const [salePrice, setSalePrice] = useState(String(item.sale_price ?? item.price));
  const [qty, setQty] = useState(String(item.quantity));
  const [error, setError] = useState<string | null>(null);

  const selling = target === "sold";
  const priceNum = Number(salePrice || 0);
  const qtyNum = Number(qty || 1);
  const expectedProfit =
    selling && item.purchase_price != null && !Number.isNaN(priceNum) && !Number.isNaN(qtyNum)
      ? (priceNum - item.purchase_price) * qtyNum
      : null;

  const handleConfirm = () => {
    if (selling && !buyer.trim()) {
      setError("Buyer name is required to mark as sold.");
      return;
    }
    if (selling && !dealDate) {
      setError("Deal date is required to mark as sold.");
      return;
    }
    if (Number.isNaN(priceNum) || priceNum < 0) {
      setError("Sale price must be zero or more.");
      return;
    }
    if (selling && (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > item.quantity)) {
      setError(`Quantity to sell must be between 1 and ${item.quantity}.`);
      return;
    }
    setError(null);
    onConfirm(
      {
        status: target,
        buyer_name: buyer.trim() || null,
        deal_date: dealDate || null,
        sale_price: Number.isNaN(priceNum) ? null : priceNum,
        quantity_sold: selling ? qtyNum : null,
      },
      target,
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="deal-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">
            {selling ? "Close deal" : "Mark as pending"}
          </DialogTitle>
          <DialogDescription>
            {selling
              ? "Record the buyer and deal date — the item moves to the Sold tab automatically."
              : "Log the interested buyer. You can close the deal later."}
          </DialogDescription>
        </DialogHeader>

        <div data-testid="deal-form" className="grid gap-4">
          <p className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm">
            <span className="font-medium text-slate-100">{item.name}</span>
            <span className="text-slate-400">
              {" · "}list {formatAud(item.price)}/unit · qty {item.quantity}
            </span>
            {item.purchase_price != null && (
              <span className="text-slate-400">{" · "}bought {formatAud(item.purchase_price)}/unit</span>
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deal-buyer">Buyer name{selling ? " (required)" : ""}</Label>
            <Input
              id="deal-buyer"
              data-testid="deal-buyer"
              placeholder="Who is buying?"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
            />
          </div>
          <div className={selling && item.quantity > 1 ? "grid grid-cols-3 gap-3" : "grid-cols-2 grid gap-4"}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deal-date">Deal date{selling ? " (required)" : ""}</Label>
              <Input
                id="deal-date"
                data-testid="deal-date"
                type="date"
                value={dealDate}
                onChange={(e) => setDealDate(e.target.value)}
                className="[color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="deal-price" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Deal price/unit (AUD)
              </Label>
              <Input
                id="deal-price"
                data-testid="deal-price"
                type="number"
                min="0"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>
            {selling && item.quantity > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deal-qty" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Qty to sell
                </Label>
                <Input
                  id="deal-qty"
                  data-testid="deal-qty"
                  type="number"
                  min="1"
                  max={item.quantity}
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            )}
          </div>
          {expectedProfit != null && (
            <p
              data-testid="deal-profit-preview"
              className={`text-sm font-medium ${expectedProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              Expected {expectedProfit >= 0 ? "profit" : "loss"}: {formatAud(Math.abs(expectedProfit))}
            </p>
          )}
          {error && (
            <p data-testid="deal-form-error" className="text-sm text-red-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" data-testid="deal-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="deal-submit" onClick={handleConfirm} disabled={pending}>
            {selling ? "Confirm sale" : "Mark pending"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
