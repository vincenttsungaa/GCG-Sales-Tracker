import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { User } from "@/pages/Landing";

// The welcome window a beta tester account sees once (user.beta_welcome). Closing it, either way, tells the
// server, so it doesn't come back on another device. If that fails it simply shows again next time.

const TRY = [
  "Add a few cards from the card list, and some products (starter decks, Premium Bandai items, set parts or bundles)",
  "Edit prices, mark something pending, then sold",
  "Group listings into Stakks",
  "Search, filter and sort your listings",
  "Export to Excel by downloading it. (Sending it by email won't work this time for beta accounts, as it needs a working email to receive the file.)",
  'Check Statistics once you\'ve "sold" a few things',
  "Pick a theme you like (Account settings → Appearance)",
  "Try it on your phone as well as a computer",
];

export default function BetaWelcomeDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    queryClient.setQueryData<User | null>(["me"], (u) => (u ? { ...u, beta_welcome: false } : u));
    apiPost("/auth/beta-welcomed").catch(() => {});
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl" data-testid="beta-welcome">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Welcome to the CardStakk beta</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-slate-300">
          <p>Hi,</p>
          <p>
            Thanks for helping test CardStakk! It&apos;s a tracker for your Gundam Card Game cards and products: what you have for sale,
            what&apos;s pending with a buyer, what&apos;s sold, and the profit you made.
          </p>
          <p>
            Please don&apos;t change the email on your test account. It&apos;s a test address that can&apos;t receive mail, so &ldquo;Forgot
            password&rdquo; won&apos;t work. If you get locked out, just message me and I&apos;ll sort it out.
          </p>
          <p>Your account has the Dealer plan for the whole beta, so everything is unlocked: unlimited listings, Statistics, and the full Excel export.</p>
          <p className="pt-1 font-semibold text-slate-100">Things to try</p>
          <ul className="list-disc space-y-1 pl-5">
            {TRY.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p>Feel free to enter made-up listings. Nothing you add is public; only you can see your account.</p>
          <p className="pt-1 font-semibold text-slate-100">Feedback</p>
          <p>
            When you&apos;ve had a play, open the menu at your profile picture (top right) → <b className="text-slate-100">Beta feedback</b>. It&apos;s a
            short form with a few ratings and questions.
          </p>
          <p>If something breaks, a quick note about what you were doing (and a screenshot if you can) helps a lot.</p>
          <p>
            Thanks again,
            <br />
            CardStakk
          </p>
        </div>
        <DialogFooter>
          <Button onClick={close} data-testid="beta-welcome-close">
            Let&apos;s start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
