import type { GundamColor, ItemStatus } from "./types";

// AUD formatting (en-AU → "A$120.00") — every price in the app goes through this.
const audFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatAud(value: number): string {
  // en-AU renders AUD as "$" — force the explicit "A$" style (A$45.00) to keep AUD unambiguous.
  const formatted = audFormatter.format(value);
  return formatted.startsWith("$") ? `A$${formatted.slice(1)}` : formatted;
}

// Deal dates are YYYY-MM-DD strings; display as DD/MM/YYYY (Australian standard).
const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : dateFormatter.format(d);
}

export const COLOR_DOT_CLASS: Record<GundamColor, string> = {
  red: "bg-red-500",
  white: "bg-slate-200",
  blue: "bg-blue-500",
  green: "bg-green-500",
  purple: "bg-purple-500",
};

export const COLOR_TRIM_CLASS: Record<GundamColor, string> = {
  red: "border-l-red-500",
  white: "border-l-slate-300",
  blue: "border-l-blue-500",
  green: "border-l-green-500",
  purple: "border-l-purple-500",
};

export const STATUS_BADGE_CLASS: Record<ItemStatus, string> = {
  for_sale: "bg-blue-900/70 text-blue-100 border-blue-500/40",
  pending: "bg-amber-900/70 text-amber-100 border-amber-500/40",
  sold: "bg-green-900/70 text-green-100 border-green-500/40",
};
