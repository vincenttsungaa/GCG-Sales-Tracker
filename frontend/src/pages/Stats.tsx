import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { apiGet, apiPut, errorText } from "@/lib/api";
import { formatAud, formatDate } from "@/lib/format";
import { computeStats, monthName, RANGES, saleDay, type Month, type RangeId, type Stats as StatsData } from "@/lib/stats";
import type { CollectionItem, GundamColor, Stack } from "@/lib/types";
import type { User } from "@/pages/Landing";

// /stats — Dealer. Your sales, profit and stock over time, worked out from your own listings.
// Takes the picked theme's colours (the --st-* colours in index.css, from the theme's --rt-* ones).
// Solid colours only (no gradients or shadows on the data).
// Free and Collector see the page blurred behind a "comes with the Dealer plan" note.

const C = {
  ink: "var(--st-ink)",
  sub: "var(--st-sub)",
  muted: "var(--st-muted)",
  line: "var(--st-line)",
  soft: "var(--st-soft)",
  accent: "var(--st-acc)",
  cost: "var(--st-cost)", // chart: what the cards cost you
  profit: "var(--st-profit)", // chart: profit on top
  noCost: "var(--st-nocost)", // chart: sales with no bought price (cost unknown)
  avg: "var(--st-orange)",
  good: "var(--st-good)",
  bad: "var(--st-bad)",
};
const DOT: Record<GundamColor, string> = { red: "#dc2626", white: "#94a3b8", blue: "#2563eb", green: "#16a34a", purple: "#9333ea" };
const RANK = ["#e0b04a", "#c3ccd8", "#d1915e"]; // 1st gold, 2nd silver, 3rd bronze (solid)
const AVATAR = ["#4a6a94", "#2f8a5f", "#9a6a00", "#7c4dbd", "#b4532a"];
const STATUS: Record<string, [string, string, string]> = {
  for_sale: ["For Sale", "var(--st-acc-bg)", "var(--st-acc-text)"],
  pending: ["Pending", "var(--st-warn-bg)", "var(--st-warn)"],
  on_hold: ["Storage", "var(--st-purple-bg)", "var(--st-purple-ink)"],
};

const aud0 = (n: number) => formatAud(Math.round(n)).replace(/\.00$/, "");
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Card({ title, hint, right, children, className = "" }: { title: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 border border-[var(--st-line)] bg-[var(--rt-panel)] p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-[var(--st-muted)]">{hint}</p>}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-sm text-[var(--st-muted)]">{children}</p>;
}

// a small line of the last months under a headline number
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 240;
  const h = 30;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [(i * w) / (values.length - 1), h - 5 - ((v - min) / (max - min || 1)) * (h - 10)]);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`-4 0 ${w + 8} ${h}`} className="mt-2.5 block h-[30px] w-full" aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--rt-panel)" strokeWidth={2} />
    </svg>
  );
}

function Delta({ value, goodWhenUp = true, unit }: { value: number | null; goodWhenUp?: boolean; unit?: "days" }) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < (unit ? 0.5 : 0.005)) return null;
  const up = value > 0;
  const good = up === goodWhenUp;
  const text = unit ? `${Math.abs(Math.round(value))} ${Math.abs(Math.round(value)) === 1 ? "day" : "days"}` : pct(Math.abs(value));
  return (
    <span
      className="ml-2 inline-block rounded-full px-2 py-0.5 align-[5px] text-[11px] font-bold"
      style={{ background: good ? "var(--st-good-bg)" : "var(--st-bad-bg)", color: good ? C.good : C.bad }}
      title="Compared with the same length of time just before"
    >
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

function Tile({ label, accent, value, delta, note, spark }: { label: string; accent: string; value: ReactNode; delta?: ReactNode; note: ReactNode; spark?: ReactNode }) {
  return (
    <div className="relative min-w-0 overflow-hidden border border-[var(--st-line)] bg-[var(--rt-panel)] px-4 pt-4 pb-3 [clip-path:polygon(0_0,calc(100%-16px)_0,100%_16px,100%_100%,0_100%)]">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <p className="font-mono text-[10px] tracking-[0.14em] text-[var(--st-muted)] uppercase">{label}</p>
      <p className="mt-1.5 truncate text-[26px] leading-tight font-extrabold tracking-tight">
        {value}
        {delta}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--st-muted)]">{note}</p>
      {spark}
    </div>
  );
}

// each month's sales as one bar: cost at the bottom, profit on top, and sales with no bought price in grey
function MonthChart({ months, avg }: { months: Month[]; avg: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 230;
  const left = 56;
  const right = 96;
  const top = 26;
  const max = Math.max(...months.map((m) => m.sales), 1);
  // 4 even, whole-dollar steps (A$0, 2, 4, 6, 8 · A$0, 150, 300, 450, 600) with a little room above the tallest bar
  const raw = (max * 1.08) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const tick =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s >= raw && s >= 1 && Number.isInteger(s)) ?? Math.ceil(raw);
  const yMax = tick * 4;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const slot = (W - left - right) / months.length;
  const bw = Math.min(84, slot * 0.62);
  const y = (v: number) => top + H - (v / yMax) * H;
  const x = (i: number) => left + slot * i + (slot - bw) / 2;
  const last = months.length - 1;
  const parts = (m: Month) => {
    const costPart = Math.min(m.costs, m.sales - m.noCostSales); // a loss: the bar stops at what it sold for
    const profitPart = Math.max(m.profit, 0);
    return { costPart, profitPart, noCost: m.noCostSales };
  };
  const tip = hover == null ? null : months[hover];
  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${W} ${H + top + 34}`}
        className="block w-full"
        role="img"
        aria-label={`Sales by month: ${months.map((m) => `${monthName(m.key, true)} ${aud0(m.sales)}`).join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right + 12} y1={y(t)} y2={y(t)} stroke={t ? "var(--st-grid-line)" : C.line} strokeDasharray={t ? "3 4" : undefined} />
            <text x={left - 10} y={y(t) + 4} fontSize={11} fill="var(--st-muted)" textAnchor="end">
              {t ? aud0(t) : "0"}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const { costPart, profitPart, noCost } = parts(m);
          const yCost = y(costPart);
          const yProfit = y(costPart + profitPart);
          const yTop = y(costPart + profitPart + noCost);
          const gap = 2; // a 2px white gap between the parts of a bar
          return (
            <g key={m.key}>
              {hover === i && <rect x={x(i) - 10} y={top - 8} width={bw + 20} height={H + 8} rx={6} fill={C.accent} opacity={0.08} />}
              {costPart > 0 && <rect x={x(i)} y={yCost} width={bw} height={y(0) - yCost} fill={C.cost} />}
              {profitPart > 0 && <rect x={x(i)} y={yProfit} width={bw} height={Math.max(0, yCost - yProfit - (costPart > 0 ? gap : 0))} fill={C.profit} />}
              {noCost > 0 && <rect x={x(i)} y={yTop} width={bw} height={Math.max(0, yProfit - yTop - (costPart + profitPart > 0 ? gap : 0))} fill={C.noCost} />}
              {m.sales > 0 && (
                <text x={x(i) + bw / 2} y={yTop - 7} fontSize={11.5} fill={C.ink} textAnchor="middle" fontWeight={i === last ? 700 : 500}>
                  {aud0(m.sales)}
                </text>
              )}
              <text x={x(i) + bw / 2} y={y(0) + 20} fontSize={12} fill={C.sub} textAnchor="middle" fontWeight={hover === i ? 700 : 400}>
                {m.label}
              </text>
              {/* hit area: the whole column, bigger than the bar */}
              <rect
                x={left + slot * i}
                y={top - 8}
                width={slot}
                height={H + 30}
                fill="transparent"
                tabIndex={0}
                aria-label={`${monthName(m.key, true)}: sales ${aud0(m.sales)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ outline: "none" }}
              />
            </g>
          );
        })}
        {avg > 0 && months.length > 1 && (
          <g pointerEvents="none">
            <line x1={left} x2={W - right + 12} y1={y(avg)} y2={y(avg)} stroke={C.avg} strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={W - right + 18} y={y(avg) + 4} fontSize={11} fill="var(--st-warn)" fontWeight={700}>
              Avg {aud0(avg)}
            </text>
          </g>
        )}
      </svg>
      {tip && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-52 rounded-md border border-[var(--st-line)] bg-[var(--rt-panel)] p-3 text-xs"
          style={{ left: `clamp(0px, calc(${((x(hover) + bw / 2) / W) * 100}% - 104px), calc(100% - 208px))` }}
          role="status"
        >
          <p className="font-bold">{monthName(tip.key, true)}</p>
          <TipRow color={C.profit} label={tip.profit < 0 ? "Loss" : "Profit"} value={aud0(tip.profit)} />
          <TipRow color={C.cost} label="Cost" value={aud0(tip.costs)} />
          {tip.noCostSales > 0 && <TipRow color={C.noCost} label="No bought price" value={aud0(tip.noCostSales)} />}
          <div className="mt-1.5 flex justify-between border-t border-[var(--st-soft)] pt-1.5">
            <span className="text-[var(--st-muted)]">
              {tip.count} sold{tip.margin != null && ` · ${pct(tip.margin)} margin`}
            </span>
            <b>{aud0(tip.sales)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <i className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-[var(--st-sub)]">{label}</span>
      <b className="ml-auto">{value}</b>
    </div>
  );
}

function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--st-sub)]">
      {items.map(([label, color, line]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <i className={line ? "inline-block h-0.5 w-3.5" : "inline-block size-2.5 rounded-sm"} style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// one sale with no bought price: type what you paid for each copy and save it to that sale
function MissingCostRow({ item }: { item: CollectionItem }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const paid = Number(value);
    if (value.trim() === "" || !Number.isFinite(paid) || paid < 0) return setError("Enter what you paid, e.g. 12.50");
    setBusy(true);
    setError(null);
    try {
      // only the bought price changes; everything else on the sale stays as it is
      await apiPut<CollectionItem>(`/items/${item.id}`, { name: item.name, purchase_price: paid, expected_status: "sold" });
      await queryClient.invalidateQueries({ queryKey: ["items"] }); // the row leaves the list and the numbers update
    } catch (err) {
      setError(errorText(err, "Couldn't save the bought price."));
      setBusy(false);
    }
  };
  return (
    <li className="grid gap-x-4 gap-y-2 border-b border-[var(--st-warn-line)] py-2.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <b className="block truncate text-[var(--st-ink)]">{item.name}</b>
        <span className="text-[11px] text-[var(--st-muted)]">
          {[item.card_no, item.rarity].filter(Boolean).join(" · ")}
          {(item.card_no || item.rarity) && " · "}
          sold {formatDate(saleDay(item))}
          {item.buyer_name && ` to ${item.buyer_name}`} · {item.quantity > 1 ? `${item.quantity} copies for ` : ""}
          {formatAud((item.sale_price ?? item.price) * item.quantity)}
        </span>
        {error && (
          <span role="alert" className="block text-[11px] text-[var(--st-bad)]">
            {error}
          </span>
        )}
      </div>
      <form onSubmit={save} className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--st-sub)]">
          Paid {item.quantity > 1 ? "each" : ""}
          <span className="flex items-center rounded-md border border-[var(--st-line)] bg-[var(--rt-panel)] pl-2 text-sm">
            A$
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={`What you paid ${item.quantity > 1 ? "for each copy of" : "for"} ${item.name}`}
              className="h-8 w-20 rounded-md bg-transparent px-1.5 text-sm outline-none"
            />
          </span>
        </label>
        <button type="submit" disabled={busy} className="h-8 rounded-md bg-[var(--st-ink)] px-3 text-xs font-semibold text-[var(--st-chip-text)] disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </li>
  );
}

const TH = "border-b border-[var(--st-line)] px-1.5 py-2 text-left text-[10px] font-bold tracking-[0.1em] text-[var(--st-muted)] uppercase";
const TD = "border-b border-[var(--st-soft)] px-1.5 py-2 align-middle";

function Page({ s, stacks, range, setRange, stackId, setStackId }: {
  s: StatsData;
  stacks: Stack[];
  range: RangeId;
  setRange: (r: RangeId) => void;
  stackId: string | null;
  setStackId: (id: string | null) => void;
}) {
  const [sort, setSort] = useState<"profit" | "sales" | "sold">("profit");
  const [showMissing, setShowMissing] = useState(false);
  const n = s.now;
  const sellers = [...s.sellers].sort((a, b) => b[sort] - a[sort]).slice(0, 5);
  const spark = s.months.length > 1 ? s.months : null;
  const fastest = s.stakks.filter((g) => g.avgDays != null).map((g) => g.avgDays as number);
  const typical = fastest.length ? fastest.reduce((a, b) => a + b, 0) / fastest.length : null;
  const maxStakkProfit = Math.max(...s.stakks.map((g) => g.profit), 1);
  const maxSet = Math.max(...s.sets.map((x) => x.sales), 1);
  const setTotal = s.sets.reduce((a, x) => a + x.sales, 0) || 1;
  const lossTotal = n.losses.reduce((a, i) => a + ((i.purchase_price ?? 0) * i.quantity - (i.sale_price ?? i.price) * i.quantity), 0);
  const from = new Date(`${s.start}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="font-mono text-[11px] font-bold tracking-[0.2em] text-[var(--st-warn)] uppercase">Your numbers</p>
          <h1 className="mt-0.5 text-[30px] font-extrabold tracking-tight sm:text-[34px]">
            Statistics
            <span className="ml-3 inline-block bg-[var(--st-ink)] px-3 py-1 align-[8px] font-mono text-[10px] tracking-[0.14em] text-[#b99aff] uppercase [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]">
              ★ Dealer
            </span>
          </h1>
          <p className="mt-1 text-[13px] text-[var(--st-sub)]">Sales, profit and stock · {from} to today.</p>
        </div>
        <div role="group" aria-label="Time range" className="flex max-w-full overflow-x-auto rounded-lg border border-[var(--st-line)] bg-[var(--rt-panel)] p-[3px]">
          {RANGES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={range === id}
              onClick={() => setRange(id)}
              className={`rounded-md px-3 py-1.5 text-xs whitespace-nowrap ${range === id ? "bg-[var(--st-chip)] text-[var(--st-chip-text)]" : "text-[var(--st-sub)] hover:bg-[var(--st-soft)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Stakk"
          value={stackId ?? ""}
          onChange={(e) => setStackId(e.target.value || null)}
          className="min-h-9 rounded-lg border border-[var(--st-line)] bg-[var(--rt-panel)] px-3 text-xs"
        >
          <option value="">All Stakks</option>
          {stacks.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
          <option value="none">Not in a Stakk</option>
        </select>
      </div>

      {n.noCost > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-[var(--st-warn-line)] border-l-4 border-l-[#e8a93a] bg-[var(--st-warn-bg2)] px-4 py-2.5 text-[13px] text-[var(--st-warn-ink)]" data-testid="stats-no-cost">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--st-orange)] text-xs font-extrabold text-[var(--st-on-orange)]">!</span>
          <span className="min-w-0 flex-1">
            <b>
              {n.noCost} {n.noCost === 1 ? "sale doesn't" : "sales don't"} have a bought price.
            </b>{" "}
            {n.noCost === 1 ? "It's" : "They're"} left out of profit and margin, so add what you paid to see the full picture.
          </span>
          <button
            type="button"
            aria-expanded={showMissing}
            aria-controls="missing-cost"
            onClick={() => setShowMissing((v) => !v)}
            className="rounded-md bg-[var(--st-ink)] px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-[var(--st-chip-text)]"
          >
            {showMissing ? "Hide list" : "Add bought prices →"}
          </button>
          {showMissing && (
            <ul id="missing-cost" className="mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-[var(--st-warn-line)] bg-[var(--rt-panel)] px-3" data-testid="missing-cost-list">
              {s.missingCost.map((i) => (
                <MissingCostRow key={i.id} item={i} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Sales"
          accent={C.accent}
          value={aud0(n.sales)}
          delta={<Delta value={s.change.sales} />}
          note={`${n.count} sold${s.change.sales != null ? " · vs the period before" : ""}`}
          spark={spark && <Spark values={spark.map((m) => m.sales)} color={C.accent} />}
        />
        <Tile
          label="Profit after costs"
          accent={C.profit}
          value={<span style={{ color: n.profit < 0 ? C.bad : C.good }}>{aud0(n.profit)}</span>}
          delta={<Delta value={s.change.profit} />}
          note={
            <>
              {n.margin != null ? `${pct(n.margin)} margin` : "no bought prices yet"}
              {n.noCost > 0 && <b className="text-[var(--st-warn)]"> · {n.noCost} without a bought price</b>}
            </>
          }
          spark={spark && <Spark values={spark.map((m) => m.profit)} color={C.profit} />}
        />
        <Tile
          label="Avg. days to sell"
          accent="var(--st-orange)"
          value={n.avgDays == null ? "—" : Math.round(n.avgDays)}
          delta={<Delta value={s.change.days} goodWhenUp={false} unit="days" />}
          note="from listed to sold"
          spark={spark && <Spark values={spark.map((m) => m.avgDays ?? 0)} color="var(--st-orange)" />}
        />
        <Tile
          label="Unrealised profit"
          accent="var(--st-purple)"
          value={aud0(s.stock.unrealised)}
          note={
            <>
              {aud0(s.stock.asking)} asking · {s.stock.count} unsold
              {s.stock.noCost > 0 && ` · ${s.stock.noCost} without a bought price (left out)`}
            </>
          }
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card
          className="lg:col-span-2"
          title="Sales and profit by month"
          hint="Each bar is a month's sales: what the cards cost you, with your profit on top. Hover a month for details."
          right={
            <Legend
              items={[
                ["Cost", C.cost],
                ["Profit", C.profit],
                ...(n.noCost > 0 ? ([["No bought price", C.noCost]] as [string, string][]) : []),
                ["Monthly average", C.avg, true],
              ]}
            />
          }
        >
          {n.count === 0 ? (
            <Empty>No sales in this time yet.</Empty>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 rounded-md border border-[var(--st-soft)] bg-[var(--st-p2)] px-4 py-3">
                {s.best && <Highlight label="Best month" value={`${monthName(s.best.key, true)} · ${aud0(s.best.sales)}`} />}
                {s.bestMargin?.margin != null && <Highlight label="Best margin" value={`${monthName(s.bestMargin.key, true)} · ${pct(s.bestMargin.margin)}`} />}
                {s.slowest && <Highlight label="Slowest" value={`${monthName(s.slowest.key, true)} · ${aud0(s.slowest.sales)}`} />}
              </div>
              <MonthChart months={s.months} avg={s.monthAvg} />
            </>
          )}
        </Card>

        <Card title="Sales by set" hint="Where your sales come from: handy when deciding what to buy next.">
          {s.sets.length === 0 ? (
            <Empty>No sales in this time yet.</Empty>
          ) : (
            // one grid for every row, so the name column is as wide as the longest name and the bars still line up
            <div className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)_72px] items-center gap-x-3 gap-y-3 text-xs">
              {s.sets.map((x) => (
                <div key={x.code} className="contents">
                  <span
                    title={x.code}
                    className="max-w-40 truncate bg-[var(--st-ink)] px-2.5 py-1 text-center font-mono text-[11px] font-bold text-[var(--st-chip-text)] [clip-path:polygon(5px_0,100%_0,calc(100%-5px)_100%,0_100%)]"
                  >
                    {x.code}
                  </span>
                  <div className="h-[22px] rounded-r-[5px] bg-[var(--st-soft)]">
                    <div className="relative h-[22px] min-w-10 rounded-r-[5px] bg-[var(--st-acc)]" style={{ width: `${(x.sales / maxSet) * 100}%` }}>
                      <span className="absolute top-1 right-2 text-[11px] font-bold text-[var(--st-on-acc)]">{pct(x.sales / setTotal)}</span>
                    </div>
                  </div>
                  <b className="text-right">{aud0(x.sales)}</b>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Best sellers"
          right={
            <select aria-label="Sort best sellers" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-transparent text-xs font-bold text-[var(--st-acc-text)]">
              <option value="profit">Sort: Profit</option>
              <option value="sales">Sort: Sales</option>
              <option value="sold">Sort: Copies sold</option>
            </select>
          }
        >
          {sellers.length === 0 ? (
            <Empty>No sales in this time yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={TH}>
                      <span className="sr-only">Rank</span>
                    </th>
                    <th className={TH}>Card</th>
                    <th className={TH}>Sold</th>
                    <th className={TH}>Sales</th>
                    <th className={TH}>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((x, i) => (
                    <tr key={`${x.name}-${i}`}>
                      <td className={TD}>
                        <span className="grid size-6 place-items-center rounded-full text-[11px] font-extrabold" style={{ background: RANK[i] ?? C.soft, color: RANK[i] ? "#2a3039" : C.ink }}>
                          {i + 1}
                        </span>
                      </td>
                      <td className={TD}>
                        <b>{x.name}</b>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--st-muted)]">
                          {x.color && <i className="inline-block size-2 rounded-full" style={{ background: DOT[x.color as GundamColor] }} />}
                          {x.sub}
                          {x.rarity && <span className="rounded-[3px] bg-[var(--st-acc)] px-1 text-[9.5px] font-extrabold text-[var(--st-on-acc)]">{x.rarity}</span>}
                        </div>
                      </td>
                      <td className={TD}>{x.sold}</td>
                      <td className={TD}>{aud0(x.sales)}</td>
                      <td className={TD}>
                        {x.costed ? (
                          <span className="rounded-full px-2.5 py-0.5 font-bold" style={{ background: x.profit < 0 ? "var(--st-bad-bg)" : "var(--st-good-bg)", color: x.profit < 0 ? C.bad : C.good }}>
                            {aud0(x.profit)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--st-warn)]" title="No bought price entered">
                            no bought price
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Slow movers" hint="Unsold the longest: worth repricing or bundling.">
          {s.slow.length === 0 ? (
            <Empty>Nothing unsold. Nice.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={TH}>Listing</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Waiting</th>
                    <th className={`${TH} text-right`}>Asking</th>
                  </tr>
                </thead>
                <tbody>
                  {s.slow.map(({ item, days }) => {
                    const [label, bg, fg] = STATUS[item.status] ?? ["", C.soft, C.sub];
                    return (
                      <tr key={item.id}>
                        <td className={TD}>
                          <b>{item.name}</b>
                          <div className="mt-0.5 text-[11px] text-[var(--st-muted)]">{[item.card_no, item.rarity].filter(Boolean).join(" · ") || (item.kind === "item" ? "Item" : "Card")}</div>
                        </td>
                        <td className={TD}>
                          <span className="rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
                            {label}
                          </span>
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          <span className="mr-2 inline-block h-1.5 w-16 rounded-full bg-[var(--st-soft)] align-middle sm:w-20">
                            <span
                              className="block h-1.5 rounded-full"
                              style={{ width: `${(days / Math.max(s.slow[0].days, 1)) * 100}%`, background: days >= 60 ? "var(--st-orange)" : "#e8c06a" }}
                            />
                          </span>
                          <b>{days}d</b>
                        </td>
                        <td className={`${TD} text-right font-semibold`}>{formatAud(item.price * item.quantity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Top buyers" hint="Your repeat customers, from the buyer names on your sales.">
          {s.buyers.length === 0 ? (
            <Empty>No buyer names on these sales yet. Add one when you mark something sold.</Empty>
          ) : (
            <div className="mt-2">
              {s.buyers.map((b, i) => (
                <div key={b.name} className="grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--st-soft)] py-2.5">
                  <span className="grid size-9 place-items-center rounded-full text-xs font-extrabold text-white" style={{ background: AVATAR[i % AVATAR.length] }}>
                    {b.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate">{b.name}</b>
                    <span className="text-[11px] text-[var(--st-muted)]">
                      {b.purchases} {b.purchases === 1 ? "purchase" : "purchases"}
                    </span>
                  </div>
                  <b className="text-sm">{aud0(b.spent)}</b>
                </div>
              ))}
            </div>
          )}
          {n.losses.length > 0 && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-[var(--st-bad-line)] bg-[var(--st-bad-bg)] px-4 py-3">
              <span className="text-[26px] font-extrabold text-[var(--st-bad)]">{n.losses.length}</span>
              <div className="text-xs text-[var(--st-bad-ink)]">
                <b>{n.losses.length === 1 ? "sale" : "sales"} below cost</b>
                <br />−{aud0(lossTotal)} in total
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" title="Stakks compared" hint="Sales and profit in this time; value left is what's unsold now.">
          {s.stakks.length === 0 ? (
            <Empty>No Stakks with sales or stock yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className={TH}>Stakk</th>
                    <th className={TH}>Sales</th>
                    <th className={TH}>Profit</th>
                    <th className={TH}>Value left (unsold)</th>
                    <th className={TH}>Avg. days to sell</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stakks.map((g) => {
                    const speed = g.avgDays == null || typical == null ? "" : g.avgDays <= typical ? "fast" : g.avgDays >= typical * 1.5 ? "slow" : "";
                    return (
                      <tr key={g.id}>
                        <td className={TD}>
                          <b>{g.name}</b>
                        </td>
                        <td className={TD}>{aud0(g.sales)}</td>
                        <td className={TD}>
                          <span className="flex items-center gap-2">
                            {g.profit > 0 && <span className="inline-block h-2 rounded-r bg-[var(--st-profit)]" style={{ width: `${(g.profit / maxStakkProfit) * 120}px` }} />}
                            <b style={{ color: g.profit < 0 ? C.bad : C.good }}>{aud0(g.profit)}</b>
                          </span>
                        </td>
                        <td className={TD}>{aud0(g.left)}</td>
                        <td className={TD}>
                          {g.avgDays == null ? (
                            <span className="text-[var(--st-muted)]">—</span>
                          ) : (
                            <span
                              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                              style={{
                                background: speed === "fast" ? "var(--st-good-bg)" : speed === "slow" ? "var(--st-warn-bg)" : C.soft,
                                color: speed === "fast" ? C.good : speed === "slow" ? "var(--st-warn)" : "var(--st-sub)",
                              }}
                            >
                              {Math.round(g.avgDays)} days
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[11px] text-[var(--st-muted)]">
      {label}
      <b className="mt-0.5 block text-[15px] text-[var(--st-ink)]">{value}</b>
    </div>
  );
}

export default function Stats({ user }: { user: User }) {
  const [range, setRange] = useState<RangeId>("6m");
  const [stackId, setStackId] = useState<string | null>(null);
  const itemsQuery = useQuery({ queryKey: ["items"], queryFn: () => apiGet<CollectionItem[]>("/items") });
  const stacksQuery = useQuery({ queryKey: ["stacks"], queryFn: () => apiGet<Stack[]>("/stacks") });
  const stacks = stacksQuery.data ?? [];
  const stats = useMemo(() => computeStats(itemsQuery.data ?? [], stacks, range, stackId), [itemsQuery.data, stacks, range, stackId]);
  const locked = user.tier < 2;

  return (
    <div className="relative isolate min-h-svh bg-[var(--rt-bg)] font-sans text-[var(--st-ink)]" data-testid="stats-page">
      <StatsBackdrop />
      {/* the same top bar as the landing page: the app's name plate, then back to the listings */}
      <header className="sticky top-0 z-30 border-b border-[var(--rt-line)] bg-[var(--rt-panel)]">
        <div className="mx-auto flex min-h-[60px] max-w-[1240px] items-stretch justify-between gap-4 pr-4 sm:pr-6">
          <a
            href="/"
            aria-label="CardStakk home"
            className="relative flex items-center gap-2.5 pr-11 pl-4 [clip-path:polygon(0_0,100%_0,calc(100%-22px)_100%,0_100%)] shadow-[inset_-1px_0_0_var(--rt-line)] sm:pl-6"
          >
            <img src="/favicon.svg" alt="" aria-hidden className="size-8 shrink-0" />
            {/* phones: the icon only, so the long "Back to your listings" button fits */}
            <span className="max-sm:hidden">
              <span className="block text-[17px] leading-[1.15] font-bold tracking-[0.16em] uppercase italic">CardStakk</span>
              <span className="block text-[8.5px] tracking-[0.16em] text-[var(--st-acc-text)] uppercase">GCG Sales Tracker</span>
            </span>
            <span aria-hidden className="absolute inset-y-0 right-[9px] w-1 -skew-x-[20deg] bg-[var(--st-acc)]" />
          </a>
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            <a href="/" className="inline-flex min-h-9 items-center rounded-lg bg-[var(--st-acc)] px-3.5 font-semibold whitespace-nowrap text-[var(--st-on-acc)] hover:brightness-110">
              Back to your listings
            </a>
          </nav>
        </div>
      </header>
      <main className="relative mx-auto max-w-[1240px] px-4 py-7 sm:px-6">
        {itemsQuery.isLoading ? (
          <p className="text-sm text-[var(--st-muted)]">Loading your numbers…</p>
        ) : itemsQuery.isError ? (
          <p className="text-sm text-[var(--st-bad)]">Couldn&apos;t load your listings. Refresh to try again.</p>
        ) : (
          <div aria-hidden={locked || undefined} inert={locked || undefined} className={locked ? "pointer-events-none blur-[6px] select-none" : undefined}>
            <Page s={stats} stacks={stacks} range={range} setRange={setRange} stackId={stackId} setStackId={setStackId} />
          </div>
        )}
        {locked && (
          <div className="absolute inset-x-4 top-24 z-10 mx-auto max-w-md border border-[var(--st-line)] bg-[var(--rt-panel)] p-6 text-center sm:inset-x-6" data-testid="stats-locked">
            <Lock className="mx-auto size-6 text-[var(--st-acc-text)]" aria-hidden />
            <h1 className="mt-2 text-xl font-extrabold">Statistics come with the Dealer plan</h1>
            <p className="mt-2 text-sm text-[var(--st-sub)]">
              See your sales and profit by month, best sellers, slow movers, top buyers and how your Stakks compare. You&apos;re on {user.plan}.
            </p>
            <a href="/support" className="mt-4 inline-block rounded-md bg-[var(--st-acc)] px-4 py-2 text-sm font-semibold text-[var(--st-on-acc)] hover:brightness-110">
              Support
            </a>
          </div>
        )}
      </main>
    </div>
  );
}

// Behind the Statistics page: faint graph paper with a rising line and bars, fixed while the page scrolls.
// Decoration only (aria-hidden); the real numbers sit on white panels above it.
function StatsBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(var(--st-grid)_1px,transparent_1px),linear-gradient(90deg,var(--st-grid)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="absolute inset-0 bg-[linear-gradient(var(--st-grid-2)_1px,transparent_1px),linear-gradient(90deg,var(--st-grid-2)_1px,transparent_1px)] bg-[size:160px_160px]" />
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <g fill="var(--st-acc)" opacity=".07">
          {[120, 170, 145, 210, 190, 260, 240, 310, 290, 360, 340, 410].map((h, i) => (
            <rect key={i} x={60 + i * 115} y={900 - h} width="56" height={h} rx="3" />
          ))}
        </g>
        <path
          d="M0 700 L120 660 L240 680 L360 600 L480 620 L600 540 L720 560 L840 470 L960 500 L1080 410 L1200 430 L1320 340 L1440 300"
          fill="none"
          stroke="var(--st-profit)"
          strokeOpacity=".16"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <g fill="var(--st-profit)" fillOpacity=".2">
          {[[360, 600], [600, 540], [840, 470], [1080, 410], [1320, 340]].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="6" />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--st-vignette)_100%)]" />
    </div>
  );
}
