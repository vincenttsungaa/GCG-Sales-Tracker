import type { GundamColor, ItemStatus } from "./types";

// Money: every price in the app goes through formatMoney. Display only — the numbers are never converted;
// the currency (picked in the profile menu, saved on the account) just says which money they are in.
// Keep the codes in step with CURRENCIES in backend/lib/export.py.
export const CURRENCIES = {
  USD: { symbol: "US$", name: "US dollar" },
  AUD: { symbol: "A$", name: "Australian dollar" },
  PHP: { symbol: "₱", name: "Philippine peso" },
  EUR: { symbol: "€", name: "Euro" },
  JPY: { symbol: "¥", name: "Japanese yen" },
  GBP: { symbol: "£", name: "British pound" },
  CAD: { symbol: "C$", name: "Canadian dollar" },
  NZD: { symbol: "NZ$", name: "New Zealand dollar" },
} as const;
export type Currency = keyof typeof CURRENCIES;

const EURO_REGIONS = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];

// Not picked yet: a guess from the browser's region (en-US → US$, ja → ¥, de-DE → €), else A$
function guessCurrency(): Currency {
  for (const tag of typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]) {
    const [lang, region = ""] = tag.split("-");
    const r = region.toUpperCase();
    if (r === "US") return "USD";
    if (r === "AU") return "AUD";
    if (r === "PH" || lang === "fil" || lang === "tl") return "PHP";
    if (r === "GB" || r === "UK") return "GBP";
    if (r === "CA") return "CAD";
    if (r === "NZ") return "NZD";
    if (r === "JP" || lang === "ja") return "JPY";
    if (EURO_REGIONS.includes(r)) return "EUR";
  }
  return "AUD";
}

let current: Currency = guessCurrency();

export const isCurrency = (c: unknown): c is Currency => typeof c === "string" && c in CURRENCIES;

// App.tsx calls this with the account's choice before the pages render
export function setCurrency(c: string | null | undefined): void {
  current = isCurrency(c) ? c : guessCurrency();
}

export const currentCurrency = (): Currency => current;
export const currencySymbol = (): string => CURRENCIES[current].symbol;

export function formatMoney(value: number): string {
  const digits = current === "JPY" ? 0 : 2; // yen has no cents
  const n = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? "-" : ""}${currencySymbol()}${n}`;
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
  pending: "bg-amber-400 text-amber-950 border-amber-300", // solid, so it reads on any picture and theme
  on_hold: "bg-violet-900/70 text-violet-100 border-violet-500/40",
  sold: "bg-green-600 text-white border-green-500",
};
