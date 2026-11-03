import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Minus } from "lucide-react";
import { apiPost, errorText } from "@/lib/api";
import { Backdrop, type User } from "@/pages/Landing";

// /support — the plans (Free / Collector / Dealer), your current plan, joining on Buy Me a Coffee, and for the
// site owner a tool to set someone's plan by hand (a member who paid with another email, or testing). Prices in A$ per month.
const TIERS = [
  { name: "Free", price: "A$0" },
  { name: "Collector", price: "A$10 / month", recommended: true },
  { name: "Dealer", price: "A$15 / month" },
];
// the "Recommended" tag over a plan: dark red angled plate, like the plan badges
const RECOMMENDED =
  "inline-block bg-[#8a1c1a] px-2.5 py-[3px] font-mono text-[10px] font-normal tracking-[0.14em] text-white uppercase italic [clip-path:polygon(5px_0,100%_0,calc(100%-5px)_100%,0_100%)]";
type Cell = boolean | string;
const ROWS: [string, Cell, Cell, Cell][] = [
  ["Listings (not counting sold)", "100", "250", "Unlimited"],
  ["Stakks: folders, card count, filter, move to Storage", true, true, true],
  ["Each Stakk's value, sales and profit", true, true, true],
  ["Excel export: one sheet of listings and sales", false, true, true],
  ["Excel export: full workbook, by Stakk, send by email", false, false, true],
  ["Upload your own listing photos (Add Item)", true, true, true],
  ["Name with supporter badge (Limited: Founding supporter badge)", false, true, true],
  ["Statistics report", false, false, true],
];
// not built yet: listed under the table, not in it, so no one pays for a promise
const COMING: [string, string][] = [
  ["Trading tracker", "cards traded and received, plus cash, profit after cost · Dealer"],
  ["Personal collection", "track your chase cards and what you paid for each, keep a wishlist, see what's missing from a set, and move any card to For Sale in one tap · every plan, Free included"],
];

function Mark({ v }: { v: Cell }) {
  if (typeof v === "string") return <span className="font-semibold">{v}</span>;
  return v ? (
    <Check className="mx-auto size-5 text-[#1f6f43]" aria-label="Included" />
  ) : (
    <Minus className="mx-auto size-4 text-[#b4bac3]" aria-label="Not included" />
  );
}

// the owner's own account: view the site as Free / Collector / Dealer (limits and all), for testing
function PreviewPlan({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (tier: number) => {
    setBusy(true);
    setErr(null);
    try {
      queryClient.setQueryData(["me"], await apiPost<User>("/admin/preview", { tier }));
    } catch (e) {
      setErr(errorText(e, "Couldn't switch plans."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-8 border border-dashed border-[#c3ccd8] bg-white p-5" data-testid="preview-plan">
      <h2 className="font-bold">Site owner: view the site as</h2>
      <p className="mt-1 text-sm text-[#5b6470]">
        For testing. Your account acts like this plan everywhere, limits included. Nothing is deleted; pick Dealer to go back.
      </p>
      <div role="group" aria-label="View the site as" className="mt-4 inline-flex overflow-hidden rounded-md border border-[#c3ccd8]">
        {TIERS.map((t, i) => (
          <button
            key={t.name}
            type="button"
            disabled={busy}
            aria-pressed={user.tier === i}
            onClick={() => pick(i)}
            className={`min-h-10 px-4 text-sm font-semibold disabled:opacity-60 ${
              user.tier === i ? "bg-[#4a6a94] text-white" : "bg-[#f7f8fa] text-[#1f2630] hover:bg-[#eef1f5]"
            } ${i ? "border-l border-[#c3ccd8]" : ""}`}
          >
            {t.name}
          </button>
        ))}
      </div>
      {err && (
        <p role="alert" className="mt-3 text-sm text-[#b42318]">
          {err}
        </p>
      )}
    </section>
  );
}

function OwnerTool() {
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("1");
  const [months, setMonths] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const u = await apiPost<User>("/admin/tier", {
        email: email.trim(),
        tier: Number(tier),
        months: tier !== "0" && months ? Number(months) : null,
      });
      const until = u.tier_until ? ` until ${new Date(u.tier_until).toLocaleDateString()}` : "";
      // the owner and PERKS_EMAILS accounts always get every perk: the plan is saved, but they stay Dealer
      const kept = u.tier !== Number(tier);
      setMsg({
        ok: !kept,
        text: kept
          ? `Saved as ${TIERS[Number(tier)].name}, but ${u.email} gets every perk (site owner or PERKS_EMAILS in backend/.env), so it stays ${u.plan}.`
          : `${u.email} is now on ${u.plan}${until}.${u.tier ? " They've been emailed that it's on." : ""}`,
      });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, "Couldn't change the plan.") });
    } finally {
      setBusy(false);
    }
  };
  const field = "min-h-10 border border-[#c3ccd8] bg-[#f7f8fa] px-3 text-sm";
  return (
    <section className="mt-8 border border-dashed border-[#c3ccd8] bg-white p-5" data-testid="owner-tool">
      <h2 className="font-bold">Site owner: set someone&apos;s plan</h2>
      <p className="mt-1 text-sm text-[#5b6470]">
        Buy Me a Coffee members switch on and off by themselves. Use this for a member who paid with a different email (no
        end date: set it back to Free if they cancel), or for testing. Leave months empty for no end date.
      </p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold tracking-wider text-[#5b6470] uppercase">
          Account email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold tracking-wider text-[#5b6470] uppercase">
          Plan
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={field}>
            <option value="0">Free</option>
            <option value="1">Collector</option>
            <option value="2">Dealer</option>
          </select>
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs font-semibold tracking-wider text-[#5b6470] uppercase">
          Months
          <input type="number" min={1} max={36} value={months} disabled={tier === "0"} onChange={(e) => setMonths(e.target.value)} className={field} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-10 items-center gap-2 rounded-md bg-[#4a6a94] px-4 text-sm font-semibold text-white hover:bg-[#3f5c82] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save
        </button>
      </form>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-[#1f6f43]" : "text-[#b42318]"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

const BMC_URL = "https://buymeacoffee.com/cardstakk/membership";

// memberships are Buy Me a Coffee memberships (card payments by Stripe); the plan switches on by itself
// when the BMC email matches a confirmed CardStakk account (backend/routers/bmc.py)
interface TransferCheck {
  done: boolean;
  moving_listings: number;
  moving_stakks: number;
  deleting_listings: number;
  deleting_stakks: number;
  plan: string;
  plan_until: string | null;
  founding: boolean;
}

// site owner: move one account's listings, Stakks and plan into another (e.g. someone signed up again with a new email).
// Check first shows what will happen; the move needs the receiving email typed again.
function TransferTool() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [check, setCheck] = useState<TransferCheck | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "min-h-10 border border-[#c3ccd8] bg-[#f7f8fa] px-3 text-sm";
  const lbl = "flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold tracking-wider text-[#5b6470] uppercase";
  const call = async (dryRun: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiPost<TransferCheck>("/admin/transfer", { from_email: from.trim(), to_email: to.trim(), dry_run: dryRun, confirm });
      if (dryRun) setCheck(r);
      else {
        setCheck(null);
        setConfirm("");
        setMsg({ ok: true, text: `Done: ${r.moving_listings} listings and ${r.moving_stakks} Stakks moved to ${to.trim()}, with the ${r.plan} plan.` });
      }
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "Couldn't move the account's data.") });
    } finally {
      setBusy(false);
    }
  };
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return (
    <section className="mt-8 border border-dashed border-[#c3ccd8] bg-white p-5" data-testid="transfer-tool">
      <h2 className="font-bold">Site owner: move an account&apos;s data to another account</h2>
      <p className="mt-1 text-sm text-[#5b6470]">
        Moves every listing and Stakk, and the plan (end date and Founding badge too). The receiving account&apos;s own listings and
        Stakks are deleted first. The old account stays, empty, on Free.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void call(true);
        }}
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        <label className={lbl}>
          From (old account)
          <input type="email" required value={from} onChange={(e) => (setFrom(e.target.value), setCheck(null))} className={field} />
        </label>
        <label className={lbl}>
          To (receiving account)
          <input type="email" required value={to} onChange={(e) => (setTo(e.target.value), setCheck(null))} className={field} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-10 items-center gap-2 rounded-md bg-[#4a6a94] px-4 text-sm font-semibold text-white hover:bg-[#3f5c82] disabled:opacity-60"
        >
          {busy && !check && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Check
        </button>
      </form>
      {check && (
        <div className="mt-4 border border-[#e8c9c7] bg-[#fbf3f2] p-4 text-sm" data-testid="transfer-check">
          <ul className="list-disc space-y-1 pl-5 text-[#3d4550]">
            <li>
              Moves <b>{n(check.moving_listings, "listing")}</b> and <b>{n(check.moving_stakks, "Stakk")}</b> from {from.trim()} to {to.trim()}.
            </li>
            <li>
              <b className="text-[#b42318]">Deletes</b> {to.trim()}&apos;s own {n(check.deleting_listings, "listing")} and{" "}
              {n(check.deleting_stakks, "Stakk")}, for good.
            </li>
            <li>
              {to.trim()} gets the <b>{check.plan}</b> plan
              {check.plan_until ? ` until ${new Date(check.plan_until).toLocaleDateString()}` : ""}
              {check.founding ? ", with the Founding badge" : ""}. {from.trim()} goes back to Free.
            </li>
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void call(false);
            }}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <label className={lbl}>
              Type {to.trim()} to confirm
              <input type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
            </label>
            <button
              type="submit"
              disabled={busy || confirm.trim().toLowerCase() !== to.trim().toLowerCase()}
              className="flex min-h-10 items-center gap-2 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Move everything
            </button>
          </form>
        </div>
      )}
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-[#1f6f43]" : "text-[#b42318]"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function BecomeSupporter({ user }: { user: User | null }) {
  const paid = !!user && !user.is_admin && user.tier > 0;
  const button =
    "inline-flex min-h-10 items-center gap-2 rounded-md bg-[#8a1c1a] px-4 text-sm font-semibold text-white hover:bg-[#6e1513]";
  return (
    <section className="mt-6 border border-[#d5dbe3] bg-white p-5" data-testid="become-supporter">
      <h2 className="font-bold">{paid ? "Your membership" : "Become a supporter"}</h2>
      {!user ? (
        <>
          <p className="mt-1 text-sm text-[#5b6470]">
            Make a free account first, then join on Buy Me a Coffee with the same email: your plan switches on by itself.
          </p>
          <a href="/" className={`mt-4 ${button}`}>
            Sign up free
          </a>
        </>
      ) : (
        <>
          <p className="mt-1 max-w-[44em] text-sm text-[#5b6470]">
            {paid ? (
              <>
                You&apos;re on <b className="text-[#1f2630]">{user.plan}</b>. To change or cancel it, go to Buy Me a Coffee; you keep it
                until the end of the month you paid for.
              </>
            ) : (
              <>
                Memberships are on Buy Me a Coffee (pay by card, renews monthly, cancel any time). Join with{" "}
                <b className="text-[#1f2630]">{user.email}</b>, the same email as this account, and your plan switches on by itself
                within a minute or two.
              </>
            )}
          </p>
          {/* only before a plan is on: a plan the owner set by hand is already on, confirmed or not */}
          {!user.email_verified && !paid && (
            <p className="mt-3 text-sm text-[#8a5a00]">Confirm your email first (check your inbox): perks switch on once it&apos;s confirmed.</p>
          )}
          <a href={BMC_URL} target="_blank" rel="noopener noreferrer" className={`mt-4 ${button}`}>
            {paid ? "Manage on Buy Me a Coffee" : "Join on Buy Me a Coffee"} <ExternalLink className="size-4" aria-hidden />
          </a>
          <p className="mt-3 text-xs text-[#6b7480]">
            Used a different email on Buy Me a Coffee? Send feedback from Account settings (Support and memberships) and we&apos;ll
            link it.
          </p>
        </>
      )}
    </section>
  );
}

export default function Support({ user }: { user: User | null }) {
  return (
    <div className="relative isolate min-h-svh font-sans text-[#1f2630]">
      <Backdrop />
      {/* the same top bar as the landing page: the app's name plate, then the menu */}
      <header className="sticky top-0 z-30 border-b border-[#dbe1e8] bg-white">
        <div className="mx-auto flex min-h-[60px] max-w-[1120px] items-stretch justify-between gap-4 pr-4 sm:pr-6">
          <a
            href="/"
            aria-label="CardStakk home"
            className="relative flex items-center gap-2.5 pr-11 pl-4 [clip-path:polygon(0_0,100%_0,calc(100%-22px)_100%,0_100%)] shadow-[inset_-1px_0_0_#dbe1e8] sm:pl-6"
          >
            <img src="/favicon.svg" alt="" aria-hidden className="size-8 shrink-0" />
            {/* phones: the icon only, so the long "Back to your listings" button fits */}
            <span className="max-sm:hidden">
              <span className="block text-[17px] leading-[1.15] font-bold tracking-[0.16em] uppercase italic">CardStakk</span>
              <span className="block text-[8.5px] tracking-[0.16em] text-[#4a6a94] uppercase">GCG Sales Tracker</span>
            </span>
            <span aria-hidden className="absolute inset-y-0 right-[9px] w-1 -skew-x-[20deg] bg-[#4a6a94]" />
          </a>
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            {user ? (
              <>
                <a href="/" className="inline-flex min-h-9 items-center rounded-lg bg-[#8a1c1a] px-3.5 font-semibold text-white hover:bg-[#6e1513]">
                  Back to your listings
                </a>
              </>
            ) : (
              <>
                <a href="/#features" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
                  Features
                </a>
                <a href="/#faq" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
                  FAQ
                </a>
                <a href="/" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
                  Log in
                </a>
                <a href="/" className="inline-flex min-h-9 items-center rounded-lg bg-[#8a1c1a] px-3.5 font-semibold text-white hover:bg-[#6e1513]">
                  Sign up free
                </a>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[960px] px-4 py-10 sm:px-6" data-testid="support-page">
        <h1 className="text-3xl font-bold">Support CardStakk</h1>
        <p className="mt-3 max-w-[40em] leading-relaxed text-[#3d4550]">
          CardStakk is free to use. Supporter memberships help pay for running the site and unlock extra features while they&apos;re
          active. If a membership ends, nothing is deleted — your listings stay, you just can&apos;t add more until you&apos;re back under
          the Free limit.
        </p>

        {user && (
          <p className="mt-5 inline-block border border-[#d5dbe3] bg-white px-4 py-2.5 text-sm" data-testid="current-plan">
            Your Membership: <b>{user.plan}</b>
            {user.tier_until && <> · until {new Date(user.tier_until).toLocaleDateString()}</>}
            {user.is_admin && <> · site owner{user.previewing && " (previewing)"}</>}
          </p>
        )}

        {/* phones: one card per plan (the 4-column table would need scrolling sideways) */}
        <div className="mt-6 space-y-3 sm:hidden" data-testid="plan-cards">
          {TIERS.map((t, i) => {
            const mine = user?.plan === t.name;
            return (
              <section
                key={t.name}
                className={`border bg-white p-4 ${mine ? "border-[#4a6a94] ring-1 ring-[#4a6a94]" : t.recommended ? "border-[#8a1c1a]/60" : "border-[#d5dbe3]"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                    {t.name}
                    {t.recommended && <span className={RECOMMENDED}>Recommended</span>}
                  </h2>
                  <span className="text-sm text-[#5b6470]">{t.price}</span>
                </div>
                {mine && <p className="mt-0.5 text-xs font-semibold text-[#4a6a94] uppercase">Your Membership</p>}
                <ul className="mt-3 space-y-2 text-sm">
                  {ROWS.map(([label, ...cells]) => {
                    const v = cells[i];
                    const soon = v === "Coming soon";
                    return (
                      <li key={label} className={`flex items-start gap-2.5 ${v === false || soon ? "text-[#6b7480]" : ""}`}>
                        <span className="mt-0.5 flex w-5 shrink-0 justify-center">
                          <Mark v={typeof v === "string" ? !soon : v} />
                        </span>
                        <span className="flex-1">
                          {label}
                          {typeof v === "string" &&
                            (soon ? (
                              <b className="ml-1 font-semibold text-[#8a5a00]">· coming soon</b>
                            ) : (
                              <b className="ml-1">· {v}</b>
                            ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-6 overflow-x-auto border border-[#d5dbe3] bg-white max-sm:hidden">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#d5dbe3]">
                <th scope="col" className="p-4 text-left font-semibold text-[#5b6470]">
                  <span className="sr-only">Feature</span>
                </th>
                {TIERS.map((t) => (
                  // align-bottom: the plan names and prices stay level with the tag over Collector
                  <th key={t.name} scope="col" className={`p-4 text-center align-bottom ${user?.plan === t.name ? "bg-[#eef3f9]" : ""}`}>
                    {t.recommended && <div className={`${RECOMMENDED} mb-1.5`}>Recommended</div>}
                    <div className="text-base font-bold">{t.name}</div>
                    <div className="mt-0.5 font-normal text-[#5b6470]">{t.price}</div>
                    {user?.plan === t.name && <div className="mt-1 text-xs font-semibold text-[#4a6a94] uppercase">Your Membership</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, ...cells]) => (
                <tr key={label} className="border-b border-[#eef1f5] last:border-0">
                  <th scope="row" className="p-4 text-left font-normal">
                    {label}
                  </th>
                  {cells.map((c, i) => (
                    <td key={i} className={`p-4 text-center ${user?.plan === TIERS[i].name ? "bg-[#eef3f9]" : ""}`}>
                      <Mark v={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-6 border border-[#d5dbe3] bg-white p-5" data-testid="coming-soon">
          <h2 className="font-bold">Coming soon</h2>
          <p className="mt-1 text-sm text-[#5b6470]">On the way, and not part of what you pay for today. More features soon!</p>
          <ul className="mt-3 space-y-2 text-sm">
            {COMING.map(([title, text]) => (
              <li key={title} className="flex gap-2.5">
                <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#8a5a00]" />
                <span>
                  <b className="font-semibold">{title}:</b> <span className="text-[#5b6470]">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <BecomeSupporter user={user} />

        {user?.is_admin && (
          <>
            <PreviewPlan user={user} />
            <OwnerTool />
            <TransferTool />
          </>
        )}
      </main>
    </div>
  );
}
