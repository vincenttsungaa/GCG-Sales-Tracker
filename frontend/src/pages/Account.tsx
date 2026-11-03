import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import ThemePicker from "@/components/ThemePreview";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorText } from "@/lib/api";
import type { CollectionItem } from "@/lib/types";
import type { User } from "@/pages/Landing";
import { AVATARS, avatarUrl, initialsOf } from "@/lib/avatars";

// /account — your log-in (name, email, password, devices), colour theme, plan and usage, and
// deleting the account (Statistics and Export are in the account menu). A fixed light page like Plans and Statistics.

const SECTIONS = [
  ["account", "Account"],
  ["picture", "Profile picture"],
  ["appearance", "Appearance"],
  ["plan", "Membership and usage"],
  ["feedback", "Feedback"],
  ["delete", "Delete account"],
] as const;
const INPUT = "min-h-10 w-full rounded-md border border-[var(--rt-line)] bg-[var(--rt-panel-2)] px-3 text-sm sm:min-h-8 sm:max-w-xs sm:px-2.5 sm:text-[13px]";
const BTN = "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--rt-line)] bg-[var(--rt-bg)] px-3 text-sm font-medium sm:min-h-8 sm:px-2.5 sm:text-[13px] hover:bg-[var(--rt-line)] disabled:opacity-60";
const PRIMARY = "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--rt-amber)] px-4 text-sm font-semibold sm:min-h-8 sm:px-3 sm:text-[13px] text-[var(--acc-on-accent)] hover:brightness-110 disabled:opacity-60";
const TIER_COLOUR = ["#ffffff", "#7fb2ff", "#b99aff"]; // Free white, Collector blue, Dealer purple (as in the header)
const FOUNDING_COLOUR = "#f3d38a"; // Founding Supporter: gold

function Section({ id, title, hint, children, danger }: { id: string; title: string; hint?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section id={id} className={`scroll-mt-20 border bg-[var(--rt-panel)] p-5 sm:p-6 ${danger ? "border-[color-mix(in_srgb,var(--acc-danger)_40%,transparent)]" : "border-[var(--rt-line)]"}`}>
      <h2 className={`text-[15px] font-extrabold ${danger ? "text-[var(--acc-danger)]" : ""}`}>{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-[var(--rt-label)]">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-[var(--rt-bg)] py-4 text-sm first-of-type:border-t-0 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="text-xs text-[var(--rt-label)]">{label}</span>
      <div className="min-w-0">{children}</div>
      {action && <div>{action}</div>}
    </div>
  );
}

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-[var(--acc-ok)]" : "text-[var(--acc-danger)]"}`}>
      {msg.text}
    </p>
  );
}

type Msg = { ok: boolean; text: string } | null;

export default function Account({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const setMe = (u: User) => queryClient.setQueryData(["me"], u);
  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<CollectionItem[]>("/items") });
  const devices = useQuery({ queryKey: ["sessions"], queryFn: () => apiGet<{ count: number }>("/auth/sessions") });

  // display name
  const [name, setName] = useState(user.name ?? "");
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const u = await apiPatch<User>("/auth/me", { name: name.trim() });
      setMe(u);
      setName(u.name ?? "");
      setNameMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setNameMsg({ ok: false, text: errorText(err, "Couldn't save your name.") });
    }
  };

  // profile picture: saved as soon as one is picked
  const [avatarMsg, setAvatarMsg] = useState<Msg>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const current = avatarUrl(user.avatar) ? user.avatar : null; // a removed picture counts as none
  const pickAvatar = async (id: string | null) => {
    if (id === current || avatarSaving) return;
    setAvatarSaving(true);
    try {
      setMe(await apiPut<User>("/auth/avatar", { avatar: id }));
      setAvatarMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setAvatarMsg({ ok: false, text: errorText(err, "Couldn't save your picture.") });
    } finally {
      setAvatarSaving(false);
    }
  };

  // email
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailMsg, setEmailMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("email");
    try {
      const u = await apiPost<User>("/auth/email", { email: newEmail.trim(), password: emailPw });
      setMe(u);
      setEmailOpen(false);
      setNewEmail("");
      setEmailPw("");
      setEmailMsg({ ok: true, text: `Email changed. We sent a confirmation link to ${u.email}.` });
    } catch (err) {
      const t = errorText(err, "Couldn't change your email.");
      setEmailMsg({ ok: false, text: t.startsWith("email:") ? "Enter a valid email address." : t });
    } finally {
      setBusy(null);
    }
  };
  const resend = async () => {
    try {
      await apiPost("/auth/resend-verification");
      setEmailMsg({ ok: true, text: `Sent. Check ${user.email} for the confirmation link.` });
    } catch (err) {
      setEmailMsg({ ok: false, text: errorText(err, "Couldn't send the email — try again later.") });
    }
  };

  // password
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) return setPwMsg({ ok: false, text: "Use at least 8 characters for the new password." });
    if (busy) return;
    setBusy("pw");
    try {
      const r = await apiPost<{ signed_out: number }>("/auth/password", { current: currentPw, new: newPw });
      setPwOpen(false);
      setCurrentPw("");
      setNewPw("");
      setPwMsg({
        ok: true,
        text: `Password changed.${r.signed_out ? ` ${r.signed_out} other ${r.signed_out === 1 ? "device was" : "devices were"} signed out.` : ""}`,
      });
      devices.refetch();
    } catch (err) {
      setPwMsg({ ok: false, text: errorText(err, "Couldn't change your password.") });
    } finally {
      setBusy(null);
    }
  };

  // other devices
  const [devMsg, setDevMsg] = useState<Msg>(null);
  const logOutOthers = async () => {
    try {
      const r = await apiPost<{ signed_out: number }>("/auth/logout-others");
      setDevMsg({ ok: true, text: `Signed out of ${r.signed_out} other ${r.signed_out === 1 ? "device" : "devices"}.` });
      devices.refetch();
    } catch (err) {
      setDevMsg({ ok: false, text: errorText(err, "Couldn't sign out the other devices.") });
    }
  };

  // delete
  const [delOpen, setDelOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [delMsg, setDelMsg] = useState<Msg>(null);
  const deleteAccount = async () => {
    if (busy) return;
    setBusy("delete");
    try {
      await apiDelete("/auth/me");
      queryClient.clear();
      window.location.assign("/");
    } catch (err) {
      setDelMsg({ ok: false, text: errorText(err, "Couldn't delete your account.") });
      setBusy(null);
    }
  };

  // feedback: emailed to the site owner, who replies to this account's email
  const topics = useQuery({ queryKey: ["feedback-topics"], queryFn: () => apiGet<string[]>("/auth/feedback/topics"), staleTime: Infinity });
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [fbMsg, setFbMsg] = useState<Msg>(null);
  const sendFeedback = async (e: FormEvent) => {
    e.preventDefault();
    if (!topic) return setFbMsg({ ok: false, text: "Choose a topic." });
    if (message.trim().length < 10) return setFbMsg({ ok: false, text: "Write a little more (at least 10 characters)." });
    if (busy) return;
    setBusy("feedback");
    setFbMsg(null);
    try {
      await apiPost("/auth/feedback", { topic, message: message.trim() });
      setTopic("");
      setMessage("");
      setFbMsg({ ok: true, text: `Thanks — sent. We'll reply to ${user.email}.` });
    } catch (err) {
      setFbMsg({ ok: false, text: errorText(err, "Couldn't send your feedback — please try again later.") });
    } finally {
      setBusy(null);
    }
  };

  // usage: unsold listings, copies split off a listing counted as that listing (like the server)
  const used = new Set((items.data ?? []).filter((i) => i.status !== "sold").map((i) => i.split_from || i.id)).size;
  const limit = user.listing_limit;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="min-h-svh bg-[var(--rt-bg)] font-sans text-[var(--rt-text)]" data-testid="account-page">
      {/* the same top bar as the landing page: the app's name plate, then back to the listings */}
      <header className="sticky top-0 z-30 border-b border-[#dbe1e8] bg-white">
        <div className="mx-auto flex min-h-[60px] max-w-[1100px] items-stretch justify-between gap-4 pr-4 sm:pr-6">
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
          <nav aria-label="Main" className="flex items-center text-sm">
            <a href="/" className="inline-flex min-h-9 items-center rounded-lg bg-[#8a1c1a] px-3.5 font-semibold whitespace-nowrap text-white hover:bg-[#6e1513]">
              Back to your listings
            </a>
          </nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-7 sm:px-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Account sections" className="hidden self-start md:sticky md:top-[84px] md:block">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className={`block border-l-[3px] border-transparent px-3 py-2 text-sm hover:border-[var(--rt-line)] hover:bg-white ${id === "delete" ? "text-[var(--acc-danger)]" : "text-[var(--rt-text)]"}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <main className="min-w-0 space-y-4">
          <div>
            <h1 className="text-3xl font-extrabold">Account</h1>
            <p className="mt-1 text-sm text-[var(--rt-label)]">Your log-in, look, plan and data.</p>
          </div>

          <Section id="account" title="Account" hint="How you sign in to CardStakk.">
            <div className="mt-2">
              <Row label="Display name">
                <form onSubmit={saveName} className="flex flex-wrap gap-2">
                  <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required placeholder="Your name" aria-label="Display name" className={INPUT} />
                  <button type="submit" className={BTN}>
                    Save
                  </button>
                </form>
                <Note msg={nameMsg} />
              </Row>
              <Row
                label="Email"
                action={
                  !emailOpen && (
                    <button type="button" className={BTN} onClick={() => setEmailOpen(true)}>
                      Change email
                    </button>
                  )
                }
              >
                <span className="break-all">{user.email}</span>{" "}
                {user.email_verified ? (
                  <span className="ml-1 rounded-full bg-[color-mix(in_srgb,var(--acc-ok)_12%,transparent)] px-2 py-0.5 text-xs font-bold text-[var(--acc-ok)]">✓ Confirmed</span>
                ) : (
                  <span className="ml-1 text-xs">
                    <span className="rounded-full bg-[color-mix(in_srgb,var(--acc-warn)_14%,transparent)] px-2 py-0.5 font-bold text-[var(--acc-warn)]">Not confirmed</span>{" "}
                    <button type="button" className="font-semibold text-[var(--rt-amber)] underline" onClick={resend}>
                      Send the link again
                    </button>
                  </span>
                )}
                {emailOpen && (
                  <form onSubmit={changeEmail} className="mt-3 space-y-2">
                    <input type="email" required autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email" aria-label="New email" className={INPUT} />
                    <input type="password" required autoComplete="current-password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} placeholder="Your current password" aria-label="Your current password" className={INPUT} />
                    <p className="text-xs text-[var(--rt-label)]">You&apos;ll need to confirm the new address. Plans and perks follow your account, not the old address.</p>
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy === "email"} className={PRIMARY}>
                        {busy === "email" && <Loader2 className="size-4 animate-spin" />} Change email
                      </button>
                      <button type="button" className={BTN} onClick={() => setEmailOpen(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <Note msg={emailMsg} />
              </Row>
              <Row
                label="Password"
                action={
                  !pwOpen && (
                    <button type="button" className={BTN} onClick={() => setPwOpen(true)}>
                      Change password
                    </button>
                  )
                }
              >
                <span className="tracking-widest text-[var(--rt-label)]">••••••••••</span>
                {pwOpen && (
                  <form onSubmit={changePassword} className="mt-3 space-y-2">
                    <input type="password" required autoComplete="current-password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" aria-label="Current password" className={INPUT} />
                    <input type="password" required autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (at least 8 characters)" aria-label="New password" className={INPUT} />
                    <p className="text-xs text-[var(--rt-label)]">Other devices are signed out; this one stays signed in.</p>
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy === "pw"} className={PRIMARY}>
                        {busy === "pw" && <Loader2 className="size-4 animate-spin" />} Change password
                      </button>
                      <button type="button" className={BTN} onClick={() => setPwOpen(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <Note msg={pwMsg} />
              </Row>
              <Row
                label="Signed in on"
                action={
                  (devices.data?.count ?? 0) > 1 && (
                    <button type="button" className={BTN} onClick={logOutOthers}>
                      Log out everywhere else
                    </button>
                  )
                }
              >
                <span className="text-[var(--rt-text)]">
                  {devices.data == null
                    ? "…"
                    : devices.data.count <= 1
                      ? "Just this device"
                      : `${devices.data.count} devices, this one included`}
                </span>
                <Note msg={devMsg} />
              </Row>
            </div>
          </Section>

          <Section id="picture" title="Profile picture" hint="Shown in the top bar. Pick one, or keep your initials.">
            <div role="radiogroup" aria-label="Profile picture" className="mt-4 flex flex-wrap gap-3" data-testid="avatar-picker">
              {[{ id: null, url: null }, ...AVATARS].map((a) => {
                const on = a.id === current;
                return (
                  <button
                    key={a.id ?? "initials"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={a.id ? `Picture ${a.id.replace(/\D+/g, " ").trim() || a.id}` : "Your initials"}
                    disabled={avatarSaving}
                    onClick={() => pickAvatar(a.id)}
                    data-testid={`avatar-${a.id ?? "initials"}`}
                    className={`grid size-16 place-items-center overflow-hidden rounded-full border-2 p-0.5 transition disabled:opacity-60 ${
                      on ? "border-[var(--rt-amber)] ring-2 ring-[var(--rt-amber)]/30" : "border-transparent hover:border-[var(--rt-label)]"
                    }`}
                  >
                    {a.url ? (
                      <img src={a.url} alt="" className="size-full rounded-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center rounded-full bg-[var(--rt-amber)] text-sm font-extrabold text-[var(--acc-on-accent)]">{initialsOf(user)}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <Note msg={avatarMsg} />
          </Section>

          <Section id="appearance" title="Appearance" hint="The colours of your listings page. Saved on this device.">
            <ThemePicker />
          </Section>

          <Section id="plan" title="Membership and usage">
            <div className="mt-2">
              <Row
                label="Your Membership"
                action={
                  <a href="/support" className={BTN}>
                    Support
                  </a>
                }
              >
                <span
                  className="inline-block bg-[#1f2630] px-3 py-1 font-mono text-[10px] tracking-[0.14em] uppercase [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]"
                  style={{ color: user.founding ? FOUNDING_COLOUR : (TIER_COLOUR[user.tier] ?? "#fff") }}
                >
                  {user.tier > 0 && "★ "}
                  {user.plan}
                  {user.founding && " · Founding"}
                </span>
                {user.tier_until && <span className="ml-2 text-xs text-[var(--rt-label)]">until {new Date(user.tier_until).toLocaleDateString()}</span>}
              </Row>
              <Row label="Listings">
                <span>
                  {items.data ? used : "…"} unsold {limit ? `of ${limit}` : "· no limit"}
                </span>
                {limit != null && (
                  <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-[var(--rt-bg)]" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? "#c27c0e" : "var(--rt-amber)" }} />
                  </span>
                )}
              </Row>
            </div>
          </Section>

          <Section id="feedback" title="Feedback" hint="Found a bug, have a question or an idea? Send it here.">
            <form onSubmit={sendFeedback} className="mt-4 space-y-3" data-testid="feedback-form">
              <label className="block text-xs font-semibold text-[var(--rt-label)]">
                Topic
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  required
                  className="mt-1 block min-h-10 w-full rounded-md border border-[var(--rt-line)] bg-[var(--rt-panel-2)] px-3 text-sm font-normal text-[var(--rt-text)] sm:min-h-8 sm:max-w-xs sm:px-2.5 sm:text-[13px]"
                >
                  <option value="" disabled>
                    Choose a topic
                  </option>
                  {(topics.data ?? []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--rt-label)]">
                Message
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={4}
                  placeholder="What happened, or what would you like? For a bug, say what you clicked and what you expected."
                  className="mt-1 block w-full rounded-md border border-[var(--rt-line)] bg-[var(--rt-panel-2)] p-3 text-sm font-normal text-[var(--rt-text)] sm:max-w-xl sm:p-2.5 sm:text-[13px]"
                />
                <span className="mt-1 block text-right font-normal text-[var(--rt-label)] sm:max-w-xl">{message.length}/3000</span>
              </label>
              <p className="text-xs text-[var(--rt-label)]">
                We&apos;ll reply to <b>{user.email}</b>
                {!user.email_verified && " — confirm it above so our reply reaches you"}.
              </p>
              <button type="submit" disabled={busy === "feedback"} className={PRIMARY}>
                {busy === "feedback" && <Loader2 className="size-4 animate-spin" />} Send feedback
              </button>
              <Note msg={fbMsg} />
            </form>
          </Section>

          <Section id="delete" title="Delete account" danger hint="Deletes your account, listings, Stakks and log-ins for good. Export first if you want a copy.">
            {!delOpen ? (
              <button type="button" className="mt-4 inline-flex min-h-9 items-center rounded-md border border-[color-mix(in_srgb,var(--acc-danger)_40%,transparent)] bg-[var(--rt-panel)] px-3 text-sm font-semibold text-[var(--acc-danger)] hover:bg-[color-mix(in_srgb,var(--acc-danger)_8%,transparent)]" onClick={() => setDelOpen(true)}>
                Delete my account…
              </button>
            ) : (
              <div className="mt-4 space-y-2 rounded-md border border-[color-mix(in_srgb,var(--acc-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--acc-danger)_8%,transparent)] p-4">
                <p className="text-sm">
                  This can&apos;t be undone. Type <b>DELETE</b> to confirm.
                </p>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" className={INPUT} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={confirmText.trim() !== "DELETE" || busy === "delete"}
                    onClick={deleteAccount}
                    className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#b42318] px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "delete" && <Loader2 className="size-4 animate-spin" />} Delete for good
                  </button>
                  <button type="button" className={BTN} onClick={() => setDelOpen(false)}>
                    Cancel
                  </button>
                </div>
                <Note msg={delMsg} />
              </div>
            )}
          </Section>
        </main>
      </div>
    </div>
  );
}
