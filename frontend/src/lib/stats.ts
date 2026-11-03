// The Statistics page's numbers, worked out in the browser from your own listings (no extra server calls).
// Sales without a bought price are never given a made-up cost: they're left out of profit and margin,
// shown in the chart as their own grey "No bought price" part, and counted so the page can say so.
import { saleProfit, saleTotal, type CollectionItem, type Stack } from "./types";

export type RangeId = "30d" | "3m" | "6m" | "year" | "all";
export const RANGES: [RangeId, string][] = [
  ["30d", "30 days"],
  ["3m", "3 months"],
  ["6m", "6 months"],
  ["year", "This year"],
  ["all", "All time"],
];

const DAY = 86_400_000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (day: string) => day.slice(0, 7);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// the day a sale happened (YYYY-MM-DD): the deal date you entered, else when it was marked sold
export function saleDay(i: CollectionItem): string {
  return i.deal_date ?? (i.sold_at ?? i.created_at).slice(0, 10);
}

// first and last day of a range (inclusive), and the same-length period just before it (none for All time)
export function rangeDays(range: RangeId, sold: CollectionItem[], today = new Date()) {
  const end = ymd(today);
  let start: string;
  let prev: [string, string] | null = null;
  if (range === "30d") {
    start = ymd(new Date(today.getTime() - 29 * DAY));
    prev = [ymd(new Date(today.getTime() - 59 * DAY)), ymd(new Date(today.getTime() - 30 * DAY))];
  } else if (range === "3m" || range === "6m") {
    const n = range === "3m" ? 3 : 6;
    start = ymd(addMonths(today, -(n - 1)));
    prev = [ymd(addMonths(today, -(2 * n - 1))), ymd(new Date(addMonths(today, -(n - 1)).getTime() - DAY))];
  } else if (range === "year") {
    start = `${today.getFullYear()}-01-01`;
    const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    prev = [`${today.getFullYear() - 1}-01-01`, ymd(lastYear)];
  } else {
    start = sold.reduce((min, i) => (saleDay(i) < min ? saleDay(i) : min), end);
  }
  return { start, end, prev };
}

// days from listed to sold; a sold record split off a listing counts from when that listing was made
function daysToSell(i: CollectionItem, byId: Map<string, CollectionItem>): number | null {
  const listed = (i.split_from && byId.get(i.split_from)?.created_at) || i.created_at;
  const soldOn = i.sold_at ?? (i.deal_date ? `${i.deal_date}T12:00:00` : null);
  if (!soldOn) return null;
  return Math.max(0, Math.round((new Date(soldOn).getTime() - new Date(listed).getTime()) / DAY));
}

const cost = (i: CollectionItem) => (i.purchase_price == null ? null : i.purchase_price * i.quantity);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// what one group of sales adds up to
function totals(sold: CollectionItem[], byId: Map<string, CollectionItem>) {
  const costed = sold.filter((i) => i.purchase_price != null);
  const sales = sold.reduce((s, i) => s + saleTotal(i), 0);
  const costedSales = costed.reduce((s, i) => s + saleTotal(i), 0);
  const costs = costed.reduce((s, i) => s + (cost(i) ?? 0), 0);
  const profit = costedSales - costs;
  const days = sold.map((i) => daysToSell(i, byId)).filter((d): d is number => d != null);
  return {
    count: sold.length,
    sales,
    profit,
    costs,
    costedSales,
    noCost: sold.length - costed.length,
    noCostSales: sales - costedSales,
    margin: costedSales > 0 ? profit / costedSales : null,
    avgDays: avg(days),
    losses: costed.filter((i) => (saleProfit(i) ?? 0) < 0),
  };
}

export type Month = { key: string; label: string; sales: number; costs: number; profit: number; noCostSales: number; count: number; avgDays: number | null; margin: number | null };

const MONTH = new Intl.DateTimeFormat("en-AU", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" });
export const monthName = (key: string, long = false) => (long ? MONTH_LONG : MONTH).format(new Date(`${key}-01T00:00:00`));

export function computeStats(items: CollectionItem[], stacks: Stack[], range: RangeId, stackId: string | null, today = new Date()) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const scoped = stackId === null ? items : items.filter((i) => (stackId === "none" ? !i.stack_id : i.stack_id === stackId));
  const allSold = scoped.filter((i) => i.status === "sold");
  const unsold = scoped.filter((i) => i.status !== "sold");
  const { start, end, prev } = rangeDays(range, allSold, today);
  const inRange = (from: string, to: string) => allSold.filter((i) => saleDay(i) >= from && saleDay(i) <= to);
  const sold = inRange(start, end);
  const now = totals(sold, byId);
  const before = prev ? totals(inRange(prev[0], prev[1]), byId) : null;
  const change = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : (a - b) / Math.abs(b));

  // one bar per month in the range (oldest first), empty months included
  const months: Month[] = [];
  for (let m = new Date(`${monthKey(start)}-01T00:00:00`); monthKey(ymd(m)) <= monthKey(end); m = addMonths(m, 1)) {
    const key = monthKey(ymd(m));
    const t = totals(sold.filter((i) => monthKey(saleDay(i)) === key), byId);
    months.push({ key, label: monthName(key), sales: t.sales, costs: t.costs, profit: t.profit, noCostSales: t.noCostSales, count: t.count, avgDays: t.avgDays, margin: t.margin });
  }
  const withSales = months.filter((m) => m.count > 0);
  const best = withSales.reduce<Month | null>((b, m) => (!b || m.sales > b.sales ? m : b), null);
  const bestMargin = withSales.reduce<Month | null>((b, m) => (m.margin != null && (!b || m.margin > (b.margin ?? -Infinity)) ? m : b), null);
  const slowest = withSales.length > 1 ? withSales.reduce((b, m) => (m.sales < b.sales ? m : b)) : null;

  // unsold stock: asking value, what it cost (where known), the profit still to come
  const asking = unsold.reduce((s, i) => s + i.price * i.quantity, 0);
  const unsoldCosted = unsold.filter((i) => i.purchase_price != null);
  const paid = unsoldCosted.reduce((s, i) => s + (cost(i) ?? 0), 0);
  const unrealised = unsoldCosted.reduce((s, i) => s + i.price * i.quantity, 0) - paid;

  // sales by set (cards: their set; products: the code at the start of the product id)
  // products: the set code at the start of the product id when it looks like one (ST01, PB01), else "Other"
  const productSet = (id: string) => {
    const code = id.split(/[-_]/)[0].toUpperCase();
    return /^[A-Z]{1,4}\d{2}$/.test(code) && !/^SLEEVE/.test(code) ? code : "Other";
  };
  const setOf = (i: CollectionItem) => i.set_code || (i.product_id ? productSet(i.product_id) : "Other");
  const bySet = new Map<string, number>();
  for (const i of sold) bySet.set(setOf(i), (bySet.get(setOf(i)) ?? 0) + saleTotal(i));
  let sets = [...bySet.entries()].map(([code, sales]) => ({ code, sales })).sort((a, b) => b.sales - a.sales);
  if (sets.length > 6) {
    const rest = sets.slice(5).reduce((s, x) => s + x.sales, 0);
    sets = [...sets.slice(0, 5), { code: "Other", sales: rest }];
  }

  // best sellers: the same card / product added together
  const sellers = new Map<string, { name: string; sub: string; rarity: string | null; color: string | null; sold: number; sales: number; profit: number; costed: boolean }>();
  for (const i of sold) {
    const key = i.card_id ?? i.product_id ?? i.name.toLowerCase();
    const s = sellers.get(key) ?? { name: i.name, sub: i.card_no ?? i.set_code ?? (i.kind === "item" ? i.part ?? i.edition ?? "Item" : ""), rarity: i.rarity, color: i.color, sold: 0, sales: 0, profit: 0, costed: false };
    s.sold += i.quantity;
    s.sales += saleTotal(i);
    const p = saleProfit(i);
    if (p != null) {
      s.profit += p;
      s.costed = true;
    }
    sellers.set(key, s);
  }

  // slow movers: unsold the longest
  const todayMs = today.getTime();
  const slow = unsold
    .map((i) => ({ item: i, days: Math.max(0, Math.floor((todayMs - new Date(i.created_at).getTime()) / DAY)) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  // top buyers, from the names on your sales
  const buyers = new Map<string, { name: string; purchases: number; spent: number }>();
  for (const i of sold) {
    const name = i.buyer_name?.trim();
    if (!name) continue;
    const b = buyers.get(name.toLowerCase()) ?? { name, purchases: 0, spent: 0 };
    b.purchases += 1;
    b.spent += saleTotal(i);
    buyers.set(name.toLowerCase(), b);
  }

  // Stakks side by side (all of them, whatever the Stakk filter)
  const groups: { id: string; name: string }[] = [...stacks.map((s) => ({ id: s.id, name: s.name })), { id: "none", name: "Not in a Stakk" }];
  const soldAll = items.filter((i) => i.status === "sold" && saleDay(i) >= start && saleDay(i) <= end);
  const stakks = groups
    .map((g) => {
      const mine = (i: CollectionItem) => (g.id === "none" ? !i.stack_id : i.stack_id === g.id);
      const t = totals(soldAll.filter(mine), byId);
      const left = items.filter((i) => i.status !== "sold" && mine(i)).reduce((s, i) => s + i.price * i.quantity, 0);
      return { ...g, sales: t.sales, profit: t.profit, count: t.count, left, avgDays: t.avgDays };
    })
    .filter((g) => g.count > 0 || g.left > 0)
    .sort((a, b) => b.sales - a.sales);

  return {
    start,
    end,
    hasPrev: before != null,
    // the sales in this time with no bought price, newest first (the banner lists them to fill in)
    missingCost: sold.filter((i) => i.purchase_price == null).sort((a, b) => saleDay(b).localeCompare(saleDay(a))),
    now,
    change: {
      sales: change(now.sales, before?.sales ?? null),
      profit: change(now.profit, before?.profit ?? null),
      days: now.avgDays != null && before?.avgDays != null ? now.avgDays - before.avgDays : null,
    },
    months,
    monthAvg: months.length ? months.reduce((s, m) => s + m.sales, 0) / months.length : 0,
    best,
    bestMargin,
    slowest,
    stock: { count: unsold.length, asking, paid, unrealised, noCost: unsold.length - unsoldCosted.length },
    sets,
    sellers: [...sellers.values()],
    slow,
    buyers: [...buyers.values()].sort((a, b) => b.spent - a.spent).slice(0, 5),
    stakks,
  };
}
export type Stats = ReturnType<typeof computeStats>;
