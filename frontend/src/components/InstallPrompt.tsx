import { useEffect, useState } from "react";
import { Ellipsis, Share, X } from "lucide-react";

// "Add CardStakk to your home screen" — a small card at the bottom on phones, once, until closed.
// Android / Chrome: the Install button opens the browser's own install window.
// iPhone / iPad (Safari has no button for this): it says to tap ••• or Share by the address bar, then
// Add to Home Screen (newer Safari keeps Share inside the ••• menu).
// Not shown when already opened from the home screen, on computers, or after it was closed.
const KEY = "cardstakk:install-dismissed";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export default function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [open, setOpen] = useState(false);
  const ios = isIOS();

  useEffect(() => {
    if (isStandalone() || dismissed() || !window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches) return;
    if (ios) {
      setOpen(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini bar away; our card offers it instead
      setEvent(e as InstallEvent);
      setOpen(true);
    };
    const onInstalled = () => setOpen(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [ios]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private window: it just shows again next time */
    }
  };
  const install = async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") close();
    setEvent(null);
    if (outcome !== "accepted") setOpen(false); // the browser only offers it once per visit
  };

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Add CardStakk to your home screen"
      data-testid="install-prompt"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex items-center gap-3 rounded-xl border border-[var(--rt-line)] bg-[var(--rt-panel)] p-3 text-[var(--rt-text)] shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]"
    >
      <img src="/icon-192.png" alt="" className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <b className="block">Add CardStakk to your home screen</b>
        {ios ? (
          <span className="text-[13px] text-[var(--rt-label)]">
            Tap <Ellipsis className="inline size-3.5 align-[-2px]" aria-label="More" /> or <Share className="inline size-3.5 align-[-2px]" aria-label="Share" /> by the
            address bar, then Share if needed, and <b>Add to Home Screen</b>.
          </span>
        ) : (
          <span className="text-[13px] text-[var(--rt-label)]">Opens full screen, like an app.</span>
        )}
      </div>
      {!ios && (
        <button
          type="button"
          onClick={install}
          className="min-h-10 shrink-0 rounded-lg bg-[var(--rt-amber)] px-3.5 text-sm font-semibold text-[var(--rt-cta-ink,#fff)]"
        >
          Install
        </button>
      )}
      <button type="button" onClick={close} aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-[var(--rt-panel-2)]">
        <X className="size-4" />
      </button>
    </div>
  );
}
