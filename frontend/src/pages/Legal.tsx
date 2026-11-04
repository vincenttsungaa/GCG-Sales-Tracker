import type { ReactNode } from "react";
import { Backdrop } from "@/pages/Landing";

// /privacy and /terms — plain-English pages, open to everyone (signed in or not).
// A sensible starting point written for a small, free, fan-made site — not legal advice.
export const CONTACT_EMAIL = "gcgsalestrackeradmin.au@gmail.com";
const UPDATED = "3 November 2026";

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-lg font-bold">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed text-[#3d4550]">{children}</p>;
}
function L({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-[#3d4550]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
const Mail = () => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium break-all text-[#4a6a94] underline-offset-2 hover:underline">
    {CONTACT_EMAIL}
  </a>
);

function Privacy() {
  return (
    <>
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-[#5b6470]">Last updated {UPDATED}</p>
      <P>
        CardStakk is a free, unofficial, fan-made tool for tracking a Gundam Card Game collection and sales, with optional paid
        memberships. It is run by an individual in Australia. This page explains what we store about you, why, and how
        long we keep it.
      </P>

      <H>What we collect</H>
      <L
        items={[
          <>
            <b>Your account:</b> your email address, your password, your display name and the profile picture you pick. Passwords are
            stored only in scrambled (hashed) form — nobody, including us, can read them.
          </>,
          <>
            <b>What you enter:</b> your listings, Stakks, prices, notes, deals and any photos you add. This can include names of buyers you
            type in — please only enter what you need, and only with their permission.
          </>,
          <>
            <b>Login and security details:</b> a login cookie that keeps you signed in, and your IP address for a short time to stop
            repeated wrong passwords and spam sign-ups.
          </>,
          <>
            <b>Settings on your device:</b> your colour theme, and whether you closed the &ldquo;add to home screen&rdquo; message, are
            saved in your own browser, not on our servers.
          </>,
          <>
            <b>Feedback you send:</b> your message, with your account email, name and plan so we can reply.
          </>,
        ]}
      />
      <P>We don&apos;t sell or rent your information to anyone.</P>

      <H>If you become a supporter</H>
      <P>
        Supporter memberships (Collector and Dealer) are paid through Buy Me a Coffee, which takes card payments with Stripe. We
        never see your card details. Buy Me a Coffee tells us the email address you used, your name there and which membership you
        have, plus its start and end dates, so we can switch your plan on and off. Use the same email as your CardStakk account. If you
        join before signing up, we keep that membership information so your plan switches on when you sign up and confirm the same email.
        While you're a supporter, your display name (the name in Account settings, never your email) is shown publicly in the
        supporter list on the CardStakk home page. You can change that name at any time.
      </P>

      <H>Why we use it</H>
      <L
        items={[
          "To give you your account and show you your own listings and sales.",
          "To send the emails the site needs: confirming your email address, resetting your password, your Excel export when you ask for it, and membership emails (when it starts, and a reminder before it ends). We don't send marketing emails.",
          "To keep the site secure and working.",
        ]}
      />

      <H>How long we keep it</H>
      <P>
        We keep your account and listings until you delete them or ask us to delete your account. When your account is deleted, your
        listings, Stakks and login details are deleted with it. Copies in database backups are removed as those backups expire.
      </P>

      <H>Children</H>
      <P>
        CardStakk is only for people 18 or older, and we don&apos;t knowingly collect information from anyone under 18. If we learn that
        someone under 18 has an account, we&apos;ll delete it and its data.
      </P>

      <H>Contact</H>
      <P>
        Questions about your privacy: <Mail />.
      </P>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1 className="text-3xl font-bold">Terms of Use</h1>
      <p className="mt-2 text-sm text-[#5b6470]">Last updated {UPDATED}</p>
      <P>By creating an account or using CardStakk you agree to these terms. If you don&apos;t agree, please don&apos;t use the site.</P>

      <H>The service</H>
      <P>
        CardStakk is a free tool for tracking your own Gundam Card Game cards, sealed products and sales. It&apos;s run by an individual as a
        hobby project. We may add, change or remove features, or stop the service, at any time — we&apos;ll try to give notice so you can
        export your data first.
      </P>

      <H>Not official</H>
      <P>
        CardStakk is an unofficial, fan-made tool. It is not affiliated with, endorsed or sponsored by Bandai, BANDAI NAMCO, SOTSU or
        SUNRISE. Card names, card images and product photos are trademarks and copyrights of their respective owners and are shown only to
        identify the cards and products you own.
      </P>

      <H>Who can use CardStakk</H>
      <P>You must be 18 or older to make an account.</P>

      <H>Your account</H>
      <L
        items={[
          "Use a real email address you can access, and keep your password private.",
          "One person per account. You're responsible for what's done with your account.",
          <>
            Tell us at <Mail /> if you think someone else has used your account.
          </>,
        ]}
      />

      <H>Your data</H>
      <P>
        What you enter stays yours. You let us store and show it to you so the site can work — nothing more. Prices, values and totals in
        CardStakk are your own entries and calculations, not market prices or financial advice. Please keep your own backups (Export
        to Excel makes one, with a Collector or Dealer membership) — we can&apos;t promise data will never be lost.
      </P>

      <H>Fair use</H>
      <P>Please don&apos;t:</P>
      <L
        items={[
          "break the law, or enter other people's personal details without their permission;",
          "try to access other people's accounts or data, or get around the site's security or limits;",
          "overload, scrape, copy or attack the site, or use it to send spam.",
        ]}
      />
      <P>We may suspend or delete accounts that break these rules.</P>

      <H>Supporter memberships</H>
      <L
        items={[
          "CardStakk is free to use. Collector and Dealer are optional memberships, priced in Australian dollars on the Support page, that help pay for running and upgrading the site.",
          "A membership unlocks the extra features listed on the Support page while it's active. Features marked \"Coming soon\" aren't available yet.",
          "Memberships are paid and managed through Buy Me a Coffee, under its terms. They renew each month until you cancel there; you can cancel at any time, and your plan stays until the end of the period you paid for.",
          "Your plan switches on by itself when the email you used on Buy Me a Coffee matches your confirmed CardStakk email. If you used a different email, contact us and we'll link it by hand.",
          "When a membership ends, nothing is deleted: your listings stay, and you can't add more than the Free plan allows until you're back under its limit.",
          "A membership doesn't buy priority support or a guarantee that the service keeps running (CardStakk is run by one person, and we'll give notice before any big change so you can export your data).",
        ]}
      />

      <H>No guarantees</H>
      <P>
        CardStakk is provided &ldquo;as is&rdquo;. To the extent the law allows, we don&apos;t promise it will always be available,
        error-free or suitable for any purpose, and we&apos;re not responsible for losses from using it — including lost data, lost sales or
        decisions based on the numbers it shows. Nothing in these terms takes away rights you have under the Australian Consumer Law that
        can&apos;t be excluded.
      </P>

      <H>Contact</H>
      <P>
        Questions: <Mail />.
      </P>
    </>
  );
}

export default function Legal({ page }: { page: "privacy" | "terms" }) {
  return (
    <div className="relative isolate min-h-svh font-sans text-[#1f2630]">
      <Backdrop />
      {/* the same top bar as the landing page: the app's name plate, then Privacy / Terms / back */}
      <header className="sticky top-0 z-30 border-b border-[#dbe1e8] bg-white">
        <div className="mx-auto flex min-h-[60px] max-w-[1120px] items-stretch justify-between gap-4 pr-4 sm:pr-6">
          <a
            href="/"
            aria-label="CardStakk home"
            className="relative flex items-center gap-2.5 pr-9 pl-4 sm:pr-11 [clip-path:polygon(0_0,100%_0,calc(100%-22px)_100%,0_100%)] shadow-[inset_-1px_0_0_#dbe1e8] sm:pl-6"
          >
            <img src="/favicon.svg" alt="" aria-hidden className="size-8 shrink-0" />
            <span className="max-sm:hidden">
              <span className="block text-[17px] leading-[1.15] font-bold tracking-[0.16em] uppercase italic">CardStakk</span>
              <span className="block text-[8.5px] tracking-[0.16em] text-[#4a6a94] uppercase">GCG Sales Tracker</span>
            </span>
            <span aria-hidden className="absolute inset-y-0 right-[9px] w-1 -skew-x-[20deg] bg-[#4a6a94]" />
          </a>
          <nav aria-label="Legal" className="flex items-center gap-2.5 text-sm sm:gap-5">
            <a href="/privacy" aria-current={page === "privacy" ? "page" : undefined} className={page === "privacy" ? "font-semibold text-[#1c222b]" : "text-[#5a6371] hover:text-[#1c222b]"}>
              Privacy
            </a>
            <a href="/terms" aria-current={page === "terms" ? "page" : undefined} className={page === "terms" ? "font-semibold text-[#1c222b]" : "text-[#5a6371] hover:text-[#1c222b]"}>
              Terms
            </a>
            <a href="/" className="inline-flex min-h-9 items-center rounded-lg bg-[#8a1c1a] px-3 font-semibold whitespace-nowrap sm:px-3.5 text-white hover:bg-[#6e1513]">
              {/* very narrow phones (Galaxy Fold): "Back" alone, so the bar fits */}
              <span className="max-[380px]:hidden">Back to&nbsp;</span>CardStakk
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[800px] px-4 py-10 sm:px-6" data-testid={`legal-${page}`}>
        <article className="border border-[#d5dbe3] bg-white p-6 sm:p-10">{page === "privacy" ? <Privacy /> : <Terms />}</article>
      </main>
    </div>
  );
}
