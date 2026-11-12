import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Pause, Play } from "lucide-react";
import { apiGet, apiPost, errorText } from "@/lib/api";
import appShot from "@/assets/landing/app.webp";
import addCardShot from "@/assets/landing/add-card.webp";
import addItemShot from "@/assets/landing/add-item.webp";
import stakksShot from "@/assets/landing/stakks.webp";

// The signed-in user, as GET /api/auth/me returns it (backend: lib/auth.py public_user).
export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  avatar?: string | null; // profile picture from src/assets/avatars (lib/avatars.ts); none = initials
  email_verified: boolean;
  has_password: boolean;
  is_admin: boolean;
  tier: 0 | 1 | 2;
  plan: string; // "Free" | "Collector" | "Dealer"
  listing_limit: number | null; // listings that aren't sold; null = unlimited
  previewing?: boolean; // the site owner is viewing the site as a lower plan
  tier_until: string | null; // when a membership ends (ISO), if it does
  created_at?: string | null; // when the account was made (ISO); very old accounts may not have it
  founding?: boolean; // Founding Supporter (gold badge), while on a paid plan
  beta_welcome?: boolean; // a beta tester account that hasn't closed the welcome window yet
}

// Closed beta: sign-ups and memberships are paused (keep in step with CLOSED_BETA in backend/lib/auth.py)
export const CLOSED_BETA = true;

// signup → the email first, then "password" asks for the password (one less field up front)
type Mode = "signup" | "password" | "login" | "forgot" | "reset";

const DISCLAIMER =
  "CardStakk is an unofficial, fan-made tool for tracking a personal collection and sales. It is not affiliated with, endorsed or sponsored by Bandai, BANDAI NAMCO, SOTSU or SUNRISE. Card images and product photos are trademarks and copyrights of their respective owners and are shown for identification only.";

// Everyone on a paid plan, from GET /api/auth/supporters (names only), in the memberships strip.
// Each one is a small plate in the style of the app's plan badge: "★ NAME · TIER", the star and tier in the
// tier's colour (Founding gold, Dealer purple, Collector blue). Founders first. Phones show fewer at first.
const SHOWN = 24;
const SHOWN_PHONE = 12;
type Supporter = { name: string; tier: 1 | 2; founding: boolean };
const TIERS = {
  founding: { label: "Founding", colour: "text-[#f3d38a]", plate: "bg-[linear-gradient(135deg,#2a2416,#4a3d1f)] shadow-[inset_0_0_0_1px_#c9973a]" },
  dealer: { label: "Dealer", colour: "text-[#b99aff]", plate: "bg-[linear-gradient(135deg,#1f2630,#3a4556)]" },
  collector: { label: "Collector", colour: "text-[#7fb2ff]", plate: "bg-[linear-gradient(135deg,#1f2630,#3a4556)]" },
};
const tierOf = (s: Supporter) => (s.founding ? "founding" : s.tier === 2 ? "dealer" : "collector");
const PLATE =
  "inline-flex max-w-full items-center gap-[0.6em] font-mono leading-[1.2] tracking-[0.14em] whitespace-nowrap uppercase [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]";
const NAME_SIZE = "px-3 py-[5px] text-[10px]";
const COUNT_SIZE = "px-3.5 py-1.5 text-[12px] italic"; // the tier counts: 2pt bigger than the names, in italics
function Supporters() {
  const [list, setList] = useState<Supporter[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    apiGet<Supporter[]>("/auth/supporters").then(setList, () => setList([]));
  }, []);
  if (!list) return null;
  const count = (k: keyof typeof TIERS) => list.filter((s) => tierOf(s) === k).length;
  return (
    <div className="mt-5 border-t border-[#e6eaf0] pt-4" data-testid="supporters">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5a6371]">Thank you to our supporters</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TIERS) as (keyof typeof TIERS)[]).map((k) => (
            <span key={k} className={`${PLATE} ${COUNT_SIZE} ${TIERS[k].plate} ${TIERS[k].colour}`}>
              ★ {count(k)} {TIERS[k].label}
            </span>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-[#5a6371]">No supporters yet. Your name could be the first one here.</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {(all ? list : list.slice(0, SHOWN)).map((s, i) => {
              const t = TIERS[tierOf(s)];
              return (
                <li
                  key={i}
                  title={`${s.name} · ${t.label} Supporter`}
                  className={`${PLATE} ${NAME_SIZE} ${t.plate} ${!all && i >= SHOWN_PHONE ? "max-sm:hidden" : ""}`}
                >
                  <span aria-hidden className={t.colour}>
                    ★
                  </span>
                  <span className={`truncate ${s.founding ? "text-[#fff3d6]" : "text-white"}`}>{s.name}</span>
                  <span className={`flex-none ${t.colour}`}>· {t.label}</span>
                </li>
              );
            })}
          </ul>
          {!all && list.length > SHOWN_PHONE && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className={`mt-3 min-h-10 rounded-lg border border-[#dbe1e8] bg-white px-3.5 text-sm font-semibold hover:bg-[#f4f6f9] ${list.length <= SHOWN ? "sm:hidden" : ""}`}
            >
              Show all {list.length} supporters
            </button>
          )}
        </>
      )}
    </div>
  );
}

// The screenshots are of a sample account (made-up listings), taken from the app itself at 2x for sharp screens.
const FEATURES = [
  {
    title: "Add a card in seconds",
    text: "Search the full official card list by name, number or keyword, and pick the exact printing.",
    points: ["Parallels and promos included", "Unit, Pilot and token filters"],
    img: addCardShot,
    w: 576,
    h: 670,
    alt: "The Add Card window: a search for zaku with the keyword buttons and Zaku cards below",
    caption: "The Add Card window: search “zaku”, or tap a keyword like Unit or Pilot.",
  },
  {
    title: "Products too, not just cards",
    text: "Starter decks, Premium Bandai sets, sleeves and accessories come from their own product list, with each part priced if you sell them separately.",
    points: ["Filter by Starter Deck, Accessories, Premium Bandai or Other", "Something missing? Add a custom item with your own photo"],
    img: addItemShot,
    w: 576,
    h: 722,
    alt: "The Add Item window: starter decks ST11 to ST14, damage counter dice and card sleeves",
    caption: "The Add Item window, with the category filters on top.",
  },
  {
    title: "Group listings into Stakks",
    text: "Keep a binder for a market day, a set or a buyer. Move a whole Stakk to Storage and back in one go, and see what each one is worth.",
    points: [],
    img: stakksShot,
    w: 694,
    h: 481,
    alt: "Two Stakks shown as folder cards next to a single listing",
    caption: "Stakks sit in your listings as folder cards. Tap Open to see everything inside.",
    wide: true,
  },
];

const MORE = [
  ["Pending deals", "Hold a listing for a buyer with their name and date, then mark it sold."],
  ["Partial sales", "Sell 1 of 3 copies and the rest stay listed."],
  ["Bundles", "List several cards or products together at one price."],
  ["Profit after costs", "Add what you paid and see the profit on every sale."],
  ["Storage", "Put listings away without deleting them, and bring them back any time."],
  ["Price breakdown", "Price each part of a set or each card in a lot."],
  ["Export to Excel", "Your listings and sales as a spreadsheet (Collector), a sheet per Stakk if you like (Dealer)."],
  ["Statistics", "Best sellers, top buyers, slow movers and monthly profit charts."],
  ["Your own order", "Drag listings and Stakks into the order you want."],
  ["Search and filters", "Find any listing by name, type, rarity, colour or buyer."],
  ["Themes", "Eleven colour themes, light and dark."],
  ["Works on your phone", "Add, list and sell from your phone at the table."],
] as const;

const STEPS = [
  ["Create your account", "An email and a password. Confirm the email when you're ready."],
  ["Add what you own", "Cards, decks and bundles, each with your asking price."],
  ["Sell and track", "Move listings to Pending or Sold and watch your totals update."],
] as const;

const FAQ = [
  ["Is it really free?", "Yes. The Free plan keeps up to 100 listings that aren't sold, with no time limit and no payment details."],
  ["Can anyone else see my listings?", "No. Listings live in your own account and only you can see them."],
  ["Where do the card pictures come from?", "From the official card list, shown only to identify the cards you own."],
  ["Can I get my data out?", "Yes. Collector and Dealer members can export their listings and sales to Excel at any time, and anyone can ask us for a copy of their data."],
] as const;

const BRAND = "bg-[#8a1c1a] text-white hover:bg-[#6e1513]"; // the one "sign up" colour on this page
const FIELD =
  "min-h-11 w-full min-w-0 rounded-lg border border-[#dbe1e8] bg-white px-3 text-[15px] text-[#1c222b] outline-none focus-visible:border-[#4a6a94] focus-visible:ring-2 focus-visible:ring-[#4a6a94]/30";
const LINK = "font-medium text-[#3f5f8a] underline underline-offset-2 hover:text-[#1c222b]";
const WRAP = "mx-auto w-full max-w-[1120px] px-4 sm:px-6";
// hero: the plates (dark, angled, like the app's plan badge) and the notes floating over the app picture
const HERO_PLATE = "bg-[linear-gradient(135deg,#1f2630,#3a4556)] px-3 py-[5px]";
const HERO_NOTE =
  "absolute flex items-center gap-2.5 rounded-[10px] border border-[#dbe1e8] bg-white px-3.5 py-2.5 text-[13px] shadow-[0_16px_36px_-18px_rgba(28,34,43,.5)]";

// faint armour-plate lines behind the page (fixed while it scrolls); also on Support, Privacy and Terms
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(180deg,#e9ecf1_0%,#f4f5f7_55%,#e6e9ee_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_30%,rgba(138,28,26,.10),transparent_70%),radial-gradient(ellipse_60%_50%_at_80%_80%,rgba(63,95,138,.14),transparent_70%)]" />
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#8a1c1a" strokeWidth="1" className="absolute inset-0 size-full opacity-55">
        <g opacity=".35">
          <path d="M720 60 L860 140 L860 300 L720 380 L580 300 L580 140 Z" />
          <path d="M720 100 L820 160 L820 280 L720 340 L620 280 L620 160 Z" stroke="#3f5f8a" />
          <path d="M580 220 L360 120 L200 160 L120 320 L300 300 L580 300" />
          <path d="M860 220 L1080 120 L1240 160 L1320 320 L1140 300 L860 300" />
          <path d="M200 160 L60 60 M1240 160 L1380 60" />
          <path d="M300 300 L260 520 L420 640 L580 600 L580 300" stroke="#3f5f8a" />
          <path d="M1140 300 L1180 520 L1020 640 L860 600 L860 300" stroke="#3f5f8a" />
          <path d="M580 600 L720 680 L860 600 M720 380 L720 680" />
          <path d="M420 640 L360 860 M1020 640 L1080 860" />
        </g>
        <g stroke="#1d2128" opacity=".12">
          <path d="M0 760 H1440 M0 800 H1440" />
          <path d="M100 0 V900 M1340 0 V900" />
        </g>
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(233,236,241,.9)_100%)]" />
    </div>
  );
}

function Shot({ img, w, h, alt, caption, wide }: { img: string; w: number; h: number; alt: string; caption: string; wide?: boolean }) {
  return (
    <figure className="m-0">
      <img
        src={img}
        alt={alt}
        width={w}
        height={h}
        loading="lazy"
        className={`mx-auto block h-auto w-full rounded-[10px] border border-[#dbe1e8] shadow-[0_20px_50px_-28px_rgba(28,34,43,.5)] ${wide ? "" : "max-w-[480px]"}`}
      />
      <figcaption className="mt-2 text-center text-[12.5px] text-[#5a6371]">{caption}</figcaption>
    </figure>
  );
}

// The main features as a carousel: one slide at a time, swipe on phones (native scroll-snap),
// arrows and dots to move. Moves on by itself every 5 seconds, back to the first after the last;
// it holds still while the pointer or keyboard focus is on it, and the pause button stops it for good.
// Off from the start for people who ask their device for reduced motion.
const SLIDE_MS = 5000;
function FeatureCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [held, setHeld] = useState(false); // pointer over it, or focus inside
  useEffect(() => {
    if (!playing || held) return;
    const t = setTimeout(() => go((at + 1) % FEATURES.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [at, playing, held]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(FEATURES.length - 1, i)) * el.clientWidth, behavior: "smooth" });
  };
  const ARROW =
    "grid size-10 place-items-center rounded-full border border-[#dbe1e8] bg-white text-[#1c222b] shadow-sm hover:bg-[#f4f6f9] disabled:opacity-40 disabled:hover:bg-white";
  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Features"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <div
        ref={track}
        aria-live={playing ? "off" : "polite"}
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${FEATURES.length}: ${f.title}`}
            // overflow-hidden + padding: the screenshot's shadow stays inside its own slide (it used to show
            // as a grey strip at the edge of the next one)
            className="grid w-full flex-none snap-start items-center gap-4 overflow-hidden px-5 pt-2 pb-8 md:grid-cols-2 md:gap-10"
          >
            <div>
              <p className="font-mono text-xs tracking-[0.14em] text-[#8a1c1a]">
                {String(i + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
              </p>
              <h3 className="mt-1 text-xl font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[#5a6371]">{f.text}</p>
              {f.points.length > 0 && (
                <ul className="mt-2.5 list-disc pl-[18px] text-sm text-[#5a6371]">
                  {f.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <Shot {...f} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-center gap-4">
        <button type="button" className={ARROW} onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous feature">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <div className="flex gap-2">
          {FEATURES.map((f, i) => (
            <button
              key={f.title}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${f.title}`}
              aria-current={i === at}
              className={`h-2.5 rounded-full transition-all ${i === at ? "w-7 bg-[#8a1c1a]" : "w-2.5 bg-[#c9d0d9] hover:bg-[#9aa4b1]"}`}
            />
          ))}
        </div>
        <button type="button" className={ARROW} onClick={() => go(at + 1)} disabled={at === FEATURES.length - 1} aria-label="Next feature">
          <ChevronRight className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          className={ARROW}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Stop the slides moving" : "Play the slides"}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export default function Landing({
  onSignedIn,
  resetToken,
  notice: firstNotice = null,
}: {
  onSignedIn: (u: User) => void;
  resetToken?: string | null;
  notice?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : CLOSED_BETA ? "login" : "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(firstNotice);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // a double-click sends once (busy only disables the button after a re-render)
  const accountBox = useRef<HTMLDivElement>(null);
  useEffect(() => setNotice(firstNotice), [firstNotice]); // "Email confirmed" arrives after the first draw
  // arriving from another page with /#features or /#faq: the page draws only after the log-in check, so the
  // browser's own jump to the section has already been missed — do it once the sections exist
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  // switch the form (and bring it into view, focused, from the menu or the buttons further down)
  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    accountBox.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => accountBox.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }), 350);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode !== "reset" && !email.trim()) return setError("Enter your email.");
    if (mode === "signup") {
      // step 1 done: ask for the password next
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address, like you@example.com.");
      setMode("password");
      setTimeout(() => document.getElementById("auth-password")?.focus(), 0);
      return;
    }
    if ((mode === "password" || mode === "reset") && password.length < 8) return setError("Use at least 8 characters for the password.");
    if (mode === "login" && !password) return setError("Enter your password.");
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (mode === "password") onSignedIn(await apiPost<User>("/auth/signup", { email: email.trim(), password }));
      else if (mode === "login") onSignedIn(await apiPost<User>("/auth/login", { email: email.trim(), password }));
      else if (mode === "reset") {
        const u = await apiPost<User>("/auth/reset", { token: resetToken, password });
        window.history.replaceState(null, "", window.location.pathname);
        onSignedIn(u);
      } else {
        await apiPost("/auth/forgot", { email: email.trim() });
        setNotice(`If ${email.trim()} has an account, a link to set a new password is on its way. It works for 1 hour.`);
      }
    } catch (err) {
      const msg = errorText(err, "Something went wrong — try again.");
      // the server's own wording for a bad address is technical ("email: value is not a valid email address: …")
      setError(msg.startsWith("email:") ? "Enter a valid email address, like you@example.com." : msg);
    } finally {
      setBusy(false);
      sending.current = false;
    }
  };

  const heading = { password: "Choose a password", login: "Welcome back", forgot: "Reset your password", reset: "Choose a new password", signup: "" }[mode];
  const sub = {
    password: `For ${email.trim()}. At least 8 characters.`,
    login: "Log in to your listings and sales.",
    forgot: "We'll email you a link to set a new one.",
    reset: "At least 8 characters.",
    signup: "",
  }[mode];
  const submitLabel = { signup: "Create free account", password: "Create account", login: "Log in", forgot: "Send reset link", reset: "Save and log in" }[mode];
  const showPassword = mode === "password" || mode === "login" || mode === "reset";

  return (
    <div data-testid="landing" className="relative isolate flex min-h-svh flex-col font-sans text-[#1c222b]">
      <Backdrop />

      {/* top bar: the app's name plate, then the menu */}
      <header className="sticky top-0 z-30 border-b border-[#dbe1e8] bg-white">
        <div className="mx-auto flex min-h-[60px] max-w-[1120px] items-stretch justify-between gap-4 pr-4 sm:pr-6">
          <a
            href="#top"
            aria-label="CardStakk home"
            className="relative flex items-center gap-2.5 pr-11 pl-4 [clip-path:polygon(0_0,100%_0,calc(100%-22px)_100%,0_100%)] shadow-[inset_-1px_0_0_#dbe1e8] sm:pl-6"
          >
            <img src="/favicon.svg" alt="" aria-hidden className="size-8 shrink-0" />
            <span>
              <span className="block text-[17px] leading-[1.15] font-bold tracking-[0.16em] uppercase italic">CardStakk</span>
              <span className="block text-[8.5px] tracking-[0.16em] text-[#4a6a94] uppercase">GCG Sales Tracker</span>
            </span>
            <span aria-hidden className="absolute inset-y-0 right-[9px] w-1 -skew-x-[20deg] bg-[#4a6a94]" />
          </a>
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            <a href="#features" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
              Features
            </a>
            <a href="/support" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
              Memberships
            </a>
            <a href="#faq" className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
              FAQ
            </a>
            <button type="button" onClick={() => go("login")} className="text-[#5a6371] hover:text-[#1c222b] max-md:hidden">
              Log in
            </button>
            {/* phones: hidden, the sign-up form is right below in the hero */}
            {!CLOSED_BETA && (
              <button type="button" onClick={() => go("signup")} className={`min-h-9 rounded-lg px-3.5 font-semibold max-sm:hidden ${BRAND}`}>
                Sign up free
              </button>
            )}
          </nav>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* hero: the promise, the account form and what puts people at ease on the left; the app itself on the right
            (below on phones), with two notes floating over it */}
        <section className={`${WRAP} grid items-center gap-8 pt-9 pb-14 sm:pt-14 md:grid-cols-[1.05fr_1fr] md:gap-12 md:pb-16`}>
          <div className="min-w-0">
          <span className={`${PLATE} ${HERO_PLATE} text-[10.5px] text-[#f3d38a] italic max-lg:whitespace-normal`}>
            {/* two trading cards: the star is kept for supporters */}
            <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] flex-none">
              <rect x="1.5" y="3" width="8" height="11" rx="1.2" transform="rotate(-10 5.5 8.5)" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <rect x="6" y="2" width="8" height="11" rx="1.2" transform="rotate(8 10 7.5)" fill="currentColor" />
            </svg>
            For Gundam Card Game collectors and sellers
          </span>
          <h1 className="mt-4 text-[clamp(36px,5vw,56px)] leading-[1.03] font-extrabold tracking-[-0.03em] text-balance">
            Your binder, priced. Every sale,{" "}
            <em className="relative text-[#8a1c1a] italic after:absolute after:inset-x-0 after:bottom-[0.06em] after:h-[0.12em] after:-skew-x-[20deg] after:bg-[#8a1c1a]/20">
              counted.
            </em>
          </h1>
          <p className="mt-4 max-w-[500px] text-[17px] text-[#4a5361] sm:text-lg">
            Add cards from the official card list in seconds, sort them into Stakks for market days or buyers, and see the profit on every sale.
          </p>

          <div
            ref={accountBox}
            id="account"
            data-testid="account-box"
            className={`mt-6 w-full ${mode === "signup" ? "max-w-[430px]" : "max-w-[480px] rounded-xl border border-[#dbe1e8] bg-white p-5 shadow-[0_18px_50px_-28px_rgba(28,34,43,.45)]"}`}
          >
            {heading && (
              <div className="mb-3">
                <h2 className="text-xl font-bold">{heading}</h2>
                <p className="mt-0.5 text-sm break-words text-[#5a6371]">{sub}</p>
              </div>
            )}
            {/* sign-up: one joined bar, the email and the button together */}
            <form
              onSubmit={submit}
              noValidate
              className={
                mode === "signup"
                  ? "flex flex-wrap gap-1 rounded-[10px] border border-[#c9d0d9] bg-white p-1 shadow-[0_12px_30px_-20px_rgba(28,34,43,.45)] focus-within:border-[#3f5f8a] focus-within:ring-2 focus-within:ring-[#3f5f8a]/25"
                  : "flex flex-col gap-3"
              }
            >
              {mode !== "reset" && (
                <>
                  <label htmlFor="auth-email" className="sr-only">
                    Email
                  </label>
                  <input
                    id="auth-email"
                    data-testid="auth-email"
                    type="email"
                    autoComplete="email"
                    placeholder="Your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={mode === "signup" ? "h-[38px] min-w-0 flex-[1_1_180px] bg-transparent px-3 text-[15px] outline-none placeholder:text-[#8a929e]" : FIELD}
                  />
                </>
              )}
              {showPassword && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="auth-password" className="text-xs font-semibold tracking-[0.08em] text-[#5a6371] uppercase">
                      {mode === "reset" ? "New password" : "Password"}
                    </label>
                    {mode === "login" && (
                      <button type="button" onClick={() => go("forgot")} className={`text-[13px] ${LINK}`}>
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    id="auth-password"
                    data-testid="auth-password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={FIELD}
                  />
                </div>
              )}
              <button
                type="submit"
                data-testid="auth-submit"
                disabled={busy}
                className={`flex flex-[1_0_auto] items-center justify-center gap-2 font-semibold disabled:opacity-60 ${BRAND} ${
                  mode === "signup" ? "min-h-[38px] rounded-[7px] px-4 text-[14.5px]" : "min-h-11 rounded-lg px-5 text-[15px]"
                }`}
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {submitLabel}
              </button>
              {error && (
                <p role="alert" data-testid="auth-error" className={`w-full text-sm text-[#b42318] ${mode === "signup" ? "px-2 pb-1" : ""}`}>
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" data-testid="auth-notice" className={`w-full text-sm text-[#1f7a4d] ${mode === "signup" ? "px-2 pb-1" : ""}`}>
                  {notice}
                </p>
              )}
            </form>

            <p className="mt-2.5 text-[13px] text-[#5a6371]">
              {mode === "signup" && (
                <>
                  You&apos;ll set a password next. Already have an account?{" "}
                  <button type="button" onClick={() => go("login")} className={LINK}>
                    Log in
                  </button>
                </>
              )}
              {mode === "password" && (
                <>
                  By creating an account you agree to the{" "}
                  <a href="/terms" target="_blank" rel="noreferrer" className={LINK}>
                    Terms
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" className={LINK}>
                    Privacy Policy
                  </a>
                  .{" "}
                  <button type="button" onClick={() => go("signup")} className={LINK}>
                    Use a different email
                  </button>
                </>
              )}
              {mode === "login" && CLOSED_BETA && "CardStakk is in closed beta: new accounts open soon."}
              {mode === "login" && !CLOSED_BETA && (
                <>
                  New here?{" "}
                  <button type="button" onClick={() => go("signup")} className={LINK}>
                    Create a free account
                  </button>
                </>
              )}
              {(mode === "forgot" || mode === "reset") && (
                <button type="button" onClick={() => go("login")} className={LINK}>
                  Back to log in
                </button>
              )}
            </p>
          </div>

          <ul className="mt-6 flex flex-wrap gap-2">
            {["Free up to 100 listings", "No payment details", "Only you see your listings"].map((t, i) => (
              <li key={t} className={`${PLATE} ${HERO_PLATE} text-[11px] text-white italic`}>
                <span className="text-[#7fb2ff]">0{i + 1}</span>
                {t}
              </li>
            ))}
          </ul>
          </div>

          {/* the product itself: the listings page of a sample account, turned slightly on wider screens */}
          <figure className="relative m-0 min-w-0">
            <img
              src={appShot}
              width={1270}
              height={1030}
              alt="The CardStakk listings page with sample listings: a Stakk, a bundle, a Premium Bandai set, a pending card and single cards"
              className="block h-auto w-full rounded-xl border border-[#dbe1e8] shadow-[0_40px_80px_-40px_rgba(28,34,43,.55)] md:origin-left md:[transform:perspective(1600px)_rotateY(-8deg)_rotateX(3deg)]"
            />
            <div aria-hidden className={`${HERO_NOTE} -right-3 -bottom-5 max-md:hidden`}>
              <span className="grid size-[30px] place-items-center rounded-lg bg-[#8a1c1a] text-white">
                <svg viewBox="0 0 16 16" className="size-4">
                  <rect x="2" y="4" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 6.5h12M5 2.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <span>
                Stakk · Sunday market
                <b className="block text-base">6 listings</b>
              </span>
            </div>
            <div aria-hidden className={`${HERO_NOTE} -bottom-4 left-2 md:bottom-[18%] md:-left-6`}>
              <span className="grid size-[30px] place-items-center rounded-lg bg-[#1f7a4d] font-extrabold text-white">$</span>
              <span>
                Sold · Perfect Strike Gundam
                <b className="block text-base text-[#1f7a4d]">+A$4.00 profit</b>
              </span>
            </div>
          </figure>
        </section>

        <section id="features" className="scroll-mt-16 border-y border-[#dbe1e8] bg-white py-14">
          <div className={WRAP}>
            <h2 className="text-3xl leading-tight font-bold tracking-[-0.015em] text-balance">Everything a seller keeps in a notebook, done for you</h2>
            <p className="mt-2 mb-7 max-w-[620px] text-[#5a6371]">The jobs CardStakk takes off your hands, and plenty more.</p>
            <FeatureCarousel />
            <div className="mt-8 border-t border-dashed border-[#dbe1e8] pt-7">
              <h3 className="mb-3.5 text-xl font-semibold">And many more</h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {MORE.map(([t, d]) => (
                  <li key={t} className="rounded-[10px] border border-[#dbe1e8] bg-white p-3.5">
                    <b className="flex items-center gap-2 text-[15px]">
                      <span aria-hidden className="size-2 rounded-[2px] bg-[#8a1c1a]" />
                      {t}
                    </b>
                    <span className="mt-0.5 block text-[13.5px] text-[#5a6371]">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`${WRAP} py-14`}>
          <h2 className="text-3xl font-bold tracking-[-0.015em]">Start in three steps</h2>
          <p className="mt-2 mb-7 text-[#5a6371]">Most people list their first card within five minutes.</p>
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-[10px] border border-[#dbe1e8] bg-[#f4f6f9] p-[18px]">
                <span className="mb-2.5 grid size-[30px] place-items-center rounded-full bg-[#8a1c1a] font-bold text-white">{i + 1}</span>
                <b className="block">{t}</b>
                <span className="text-sm text-[#5a6371]">{d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${WRAP} pb-14`}>
          <div className="rounded-xl border border-[#dbe1e8] bg-white px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-bold">Supporter memberships</h2>
              <p className="mt-1 max-w-[560px] text-[#5a6371]">Memberships keep CardStakk running and add more listings, a supporter badge, statistics and more.</p>
            </div>
            <a href="/support" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[#dbe1e8] bg-white px-[18px] font-semibold hover:bg-[#f4f6f9]">
              See memberships <ArrowRight className="size-4" aria-hidden />
            </a>
          </div>
          <Supporters />
          </div>
        </section>

        <section id="faq" className={`${WRAP} scroll-mt-16 pb-14`}>
          <h2 className="mb-2 text-3xl font-bold tracking-[-0.015em]">Questions</h2>
          <div className="max-w-[760px]">
            {FAQ.map(([q, a]) => (
              <details key={q} className="border-b border-[#dbe1e8] py-3.5">
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-2 text-[#5a6371]">{a}</p>
              </details>
            ))}
          </div>
        </section>

      </main>

      <footer className="border-t border-[#dbe1e8] bg-white pb-20 md:pb-0">
        <div className={`${WRAP} flex flex-wrap items-start justify-between gap-x-8 gap-y-3 py-5`}>
          <p className="min-w-0 flex-[999_1_520px] text-xs leading-relaxed text-[#5a6371]">{DISCLAIMER}</p>
          <nav aria-label="Site" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <a href="/privacy" className={LINK}>
              Privacy
            </a>
            <a href="/terms" className={LINK}>
              Terms
            </a>
            <span className="text-[#5a6371]">© {new Date().getFullYear()} CardStakk</span>
          </nav>
        </div>
      </footer>

      {/* phones: log in / sign up stay one tap away */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-[#dbe1e8] bg-white px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_20px_-12px_rgba(0,0,0,.25)] md:hidden">
        <button type="button" onClick={() => go("login")} className="min-h-11 flex-1 rounded-lg border border-[#dbe1e8] bg-white font-semibold">
          Log in
        </button>
        {!CLOSED_BETA && (
          <button type="button" onClick={() => go("signup")} className={`min-h-11 flex-1 rounded-lg font-semibold ${BRAND}`}>
            Sign up free
          </button>
        )}
      </div>
    </div>
  );
}
