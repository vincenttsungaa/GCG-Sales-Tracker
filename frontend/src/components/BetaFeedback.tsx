import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2 } from "lucide-react";
import { apiPost, errorText } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { User } from "@/pages/Landing";

// The closed-beta questionnaire: a few ratings of the app's main parts and open questions, emailed to the
// owner through the normal feedback form (topic "Beta feedback"). Answers stay while the window is closed
// and reopened on the same page; they clear once sent. Once an account has sent it (beta_feedback_sent),
// the same window asks only "Did you find another bug?" (topic "Bug or something not working").

const FEATURES = [
  "Adding cards from the card list",
  "Adding products, set parts and bundles",
  "Editing listings and prices",
  "Pending and sold (deals)",
  "Stakks",
  "Search, filters and sorting",
  "Export to Excel",
  "Statistics",
  "Themes and the look",
  "Using it on a phone",
] as const;
const KEEP = ["Yes", "Probably", "Not sure", "Probably not"] as const;
const DEVICES = ["Phone", "Tablet", "Computer"] as const;
const QUESTIONS = [
  ["liked", "What did you like most?"],
  ["confusing", "What was confusing, slow or hard to find?"],
  ["broken", "Did anything break or look wrong? What were you doing?"],
  ["missing", "What's missing? One thing you'd add or change."],
  ["other", "Anything else?"],
] as const;
const MAX_TEXT = 400;
const MAX_BUG = 1000;
const NO_BUG = { where: "", what: "", expected: "" };

type Answers = { overall: number | null; keep: string | null; devices: string[]; features: Record<string, number | "skip">; text: Record<string, string> };
const EMPTY: Answers = { overall: null, keep: null, devices: [], features: {}, text: {} };

const CHIP = "min-h-9 min-w-9 rounded-md border px-2.5 text-sm transition-colors";
const chip = (on: boolean) => `${CHIP} ${on ? "border-sky-400 bg-sky-400/15 font-semibold text-sky-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`;

function Scale({ label, value, onChange, skip }: { label: string; value: number | "skip" | undefined | null; onChange: (v: number | "skip") => void; skip?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5 sm:shrink-0 sm:flex-nowrap">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)} className={chip(value === n)}>
          {n}
        </button>
      ))}
      {skip && (
        <button type="button" role="radio" aria-checked={value === "skip"} onClick={() => onChange("skip")} className={chip(value === "skip")}>
          Didn&apos;t try
        </button>
      )}
    </div>
  );
}

// A screenshot, shrunk in the browser like listing photos: at most 1600px on the long side, as a JPEG under ~1 MB
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff"; // see-through parts of a PNG would turn black as a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length < 1_400_000) return data;
    }
    throw new Error("too big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Screenshot({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onChange(await shrink(file));
    } catch {
      setError("Couldn't use that picture — try a PNG or JPG screenshot.");
    }
  };
  return (
    <div className="space-y-1.5">
      <span className="block font-semibold text-slate-100">
        Screenshot <span className="font-normal text-slate-400">(optional)</span>
      </span>
      {value ? (
        <div className="flex items-start gap-3">
          <img src={value} alt="Your screenshot" className="max-h-36 max-w-[60%] rounded-md border border-slate-700 object-contain" />
          <Button variant="outline" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <label className={`${CHIP} inline-flex cursor-pointer items-center gap-2 border-slate-700 text-slate-300 hover:border-slate-500 focus-within:border-sky-400`}>
          <ImagePlus className="size-4" aria-hidden />
          Add a screenshot
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function compose(a: Answers): string {
  const lines = [
    `Overall, easy to use: ${a.overall}/5 (1 hard, 5 easy)`,
    `Would keep using it after the beta: ${a.keep ?? "—"}`,
    `Used on: ${a.devices.join(", ") || "—"}`,
    "",
    "PARTS OF THE APP (1 poor, 5 great)",
    ...FEATURES.map((f) => `- ${f}: ${a.features[f] === "skip" ? "didn't try" : a.features[f] ? `${a.features[f]}/5` : "—"}`),
  ];
  for (const [key, q] of QUESTIONS) {
    const t = a.text[key]?.trim();
    if (t) lines.push("", q.toUpperCase(), t);
  }
  return lines.join("\n");
}

export default function BetaFeedbackDialog({ open, onOpenChange, email, done }: { open: boolean; onOpenChange: (open: boolean) => void; email: string; done: boolean }) {
  const queryClient = useQueryClient();
  const [a, setA] = useState<Answers>(EMPTY);
  const [bug, setBug] = useState(NO_BUG);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (patch: Partial<Answers>) => {
    setA((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const sendBug = async () => {
    if (bug.what.trim().length < 10) return setError("Describe what happened (at least 10 characters).");
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = [
      `Where: ${bug.where || "—"}`,
      "",
      "WHAT HAPPENED, AND WHAT THEY WERE DOING",
      bug.what.trim(),
      ...(bug.expected.trim() ? ["", "WHAT THEY EXPECTED", bug.expected.trim()] : []),
    ].join("\n");
    try {
      await apiPost("/auth/feedback", { topic: "Bug or something not working", message, screenshot: shot });
      setBug(NO_BUG);
      setShot(null);
      setSent(true);
    } catch (err) {
      setError(errorText(err, "Couldn't send it — please try again."));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (done) return sendBug();
    if (a.overall == null) {
      setError("Choose how easy CardStakk is to use (1 to 5) at the top.");
      document.getElementById("beta-overall")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/auth/feedback", { topic: "Beta feedback", message: compose(a), screenshot: shot });
      setA(EMPTY);
      setShot(null);
      setSent(true);
      // from now on the window asks about bugs only (the server remembers it too)
      queryClient.setQueryData<User | null>(["me"], (u) => (u ? { ...u, beta_feedback_sent: true } : u));
    } catch (err) {
      setError(errorText(err, "Couldn't send it — please try again."));
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setSent(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl" data-testid="beta-feedback">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">{done && !sent ? "Did you find another bug?" : "Beta feedback"}</DialogTitle>
          <DialogDescription>
            {done && !sent
              ? "Thanks for your feedback. Tell us about anything that broke or looked wrong, and we'll look into it."
              : "Thanks for testing CardStakk. Tap what fits and skip anything you're unsure about; a few words in the boxes help the most."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-2 py-2 text-sm text-slate-300" role="status">
            <p className="font-semibold text-slate-100">Sent — thank you!</p>
            <p>Every answer is read. Found a bug later? Open Beta feedback again to report it.</p>
          </div>
        ) : done ? (
          <div className="space-y-5 text-sm">
            <label className="block space-y-1.5">
              <span className="font-semibold text-slate-100">Where did it happen?</span>
              <select
                value={bug.where}
                onChange={(e) => setBug({ ...bug, where: e.target.value })}
                className="block min-h-10 w-full rounded-lg border border-slate-700 bg-transparent px-2.5 text-sm text-slate-100"
              >
                <option value="">Choose a part of the app</option>
                {FEATURES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
                <option>Logging in or Account settings</option>
                <option>Somewhere else</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="font-semibold text-slate-100">What happened, and what were you doing?</span>
              <Textarea
                rows={4}
                maxLength={MAX_BUG}
                value={bug.what}
                placeholder="e.g. I marked a card as sold and the price went back to the asking price."
                onChange={(e) => {
                  setBug({ ...bug, what: e.target.value });
                  setError(null);
                }}
              />
              <span className="block text-right text-xs text-slate-500">
                {bug.what.length}/{MAX_BUG}
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="font-semibold text-slate-100">
                What did you expect to happen? <span className="font-normal text-slate-400">(optional)</span>
              </span>
              <Textarea rows={2} maxLength={MAX_TEXT} value={bug.expected} onChange={(e) => setBug({ ...bug, expected: e.target.value })} />
            </label>
            <Screenshot value={shot} onChange={setShot} />
            <p className="text-xs text-slate-400">Sent with your account ({email}).</p>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6 text-sm">
            <fieldset id="beta-overall" className="space-y-2">
              <legend className="mb-2 font-semibold text-slate-100">
                Overall, how easy is CardStakk to use? <span className="font-normal text-slate-400">(1 hard, 5 easy)</span>
              </legend>
              <Scale label="Overall, how easy to use" value={a.overall} onChange={(v) => set({ overall: v as number })} />
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold text-slate-100">Would you keep using it after the beta?</legend>
              <div role="radiogroup" aria-label="Would you keep using it" className="flex flex-wrap gap-1.5">
                {KEEP.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={a.keep === k} onClick={() => set({ keep: k })} className={chip(a.keep === k)}>
                    {k}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold text-slate-100">
                What did you use it on? <span className="font-normal text-slate-400">(pick all that apply)</span>
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {DEVICES.map((d) => {
                  const on = a.devices.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set({ devices: on ? a.devices.filter((x) => x !== d) : [...a.devices, d] })} className={chip(on)}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1 font-semibold text-slate-100">
                How well does each part work? <span className="font-normal text-slate-400">(1 poor, 5 great)</span>
              </legend>
              <div className="divide-y divide-slate-800">
                {FEATURES.map((f) => (
                  <div key={f} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="text-slate-300">{f}</span>
                    <Scale label={f} value={a.features[f]} onChange={(v) => set({ features: { ...a.features, [f]: v } })} skip />
                  </div>
                ))}
              </div>
            </fieldset>

            {QUESTIONS.map(([key, q]) => (
              <label key={key} className="block space-y-1.5">
                <span className="font-semibold text-slate-100">{q}</span>
                <Textarea
                  rows={key === "other" ? 2 : 3}
                  maxLength={MAX_TEXT}
                  value={a.text[key] ?? ""}
                  onChange={(e) => set({ text: { ...a.text, [key]: e.target.value } })}
                />
                <span className="block text-right text-xs text-slate-500">
                  {(a.text[key] ?? "").length}/{MAX_TEXT}
                </span>
              </label>
            ))}

            <Screenshot value={shot} onChange={setShot} />
            <p className="text-xs text-slate-400">
              Sent to the CardStakk team with your account ({email}), so we know which test account it came from.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={() => close(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Later
              </Button>
              <Button onClick={send} disabled={busy} data-testid="beta-feedback-send">
                {busy && <Loader2 className="size-4 animate-spin" />} {done ? "Report the bug" : "Send feedback"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
