import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { codesFromText, readText } from "@/lib/scan";
import type { CatalogCard, CatalogProduct } from "@/lib/types";
import { CARD_CORNERS } from "@/components/ItemCard";
import { Camera, ImageUp, Loader2, RotateCcw, Search } from "lucide-react";

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";

// Scan a card or a product with the device camera: the code printed on it (GD01-001, ST09, PB02 …) is
// read from the photo and looked up — or, when no code is readable, the card / product is found from
// the rest of the text (name, pilot, traits, stats; product name on the box); picking a match opens Add Card / Add Item with it already chosen,
// so only the price, copies and the rest are left to fill in.
export default function ScanDialog({
  onClose,
  onPickCard,
  onPickProduct,
}: {
  onClose: () => void;
  onPickCard: (card: CatalogCard) => void;
  onPickProduct: (product: CatalogProduct) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null); // object URL of the photo taken
  const [reading, setReading] = useState<number | null>(null); // OCR progress, null when idle
  const [codes, setCodes] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // found from the photo's other text (name, traits, stats …), shown while the search box is empty
  const [matched, setMatched] = useState<{ cards: CatalogCard[]; products: CatalogProduct[] } | null>(null);

  // Live camera (back camera on phones). Needs https or localhost; otherwise the photo button below
  // still opens the phone's camera app.
  useEffect(() => {
    if (photo) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCameraError("Camera not available here — use “Take or choose a photo” instead."));
    if (!navigator.mediaDevices) setCameraError("Camera not available here — use “Take or choose a photo” instead.");
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [photo]);

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const scan = async (blob: Blob) => {
    setPhoto(URL.createObjectURL(blob));
    setError(null);
    setReading(0);
    try {
      const text = await readText(blob, setReading);
      const found = codesFromText(text);
      // the codes as read (their look-alike variants only go to the backend, which picks by the text)
      setCodes([...found.read, ...found.products.filter((p) => !found.cards.some((c) => c.startsWith(p)))]);
      // the card / product from the codes and the rest of the text (name, pilot, traits, stats)
      const [cards, products] = await Promise.all([
        apiPost<CatalogCard[]>("/cards/match", { text: text.slice(0, 5000), codes: found.cards.slice(0, 40) }),
        apiPost<CatalogProduct[]>("/products/match", { text: text.slice(0, 5000), codes: found.products.slice(0, 40) }),
      ]);
      setMatched({ cards, products });
      setTerm(cards.length + products.length === 0 ? (found.cards[0] ?? found.products[0] ?? "") : "");
      if (cards.length + products.length === 0 && found.cards.length + found.products.length === 0)
        setError("Couldn't recognise it — type the card number or name below, or try a sharper, closer photo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photo.");
    } finally {
      setReading(null);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob((b) => b && void scan(b), "image/jpeg", 0.92);
  };

  const q = term.trim();
  const cards = useQuery({
    queryKey: ["cards", "search", "scan", q],
    queryFn: () => apiGet<CatalogCard[]>(`/cards?limit=24&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const products = useQuery({
    queryKey: ["products", "search", "scan", q],
    queryFn: () => apiGet<CatalogProduct[]>(`/products?limit=12&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const nothing = q.length >= 2 && !cards.isFetching && !products.isFetching && !cards.data?.length && !products.data?.length;
  // what's listed: the search box's results, or (box empty) what the photo's text matched
  const cardList = q.length >= 2 ? (cards.data ?? []) : (matched?.cards ?? []);
  const productList = q.length >= 2 ? (products.data ?? []) : (matched?.products ?? []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl" data-testid="scan-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Scan a card or product</DialogTitle>
          <DialogDescription>
            Point the camera at the card number (bottom right, e.g. GD01-001) or the product code on the box (ST09, PB02 …).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-black">
            {photo ? (
              <img src={photo} alt="Scanned photo" className="max-h-[45svh] w-full object-contain" data-testid="scan-photo" />
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="max-h-[45svh] w-full object-contain" data-testid="scan-video" />
            )}
            {reading != null && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-slate-100">
                <Loader2 className="size-4 animate-spin" /> Reading the photo… {reading}%
              </div>
            )}
          </div>
          {cameraError && !photo && <p className="text-xs text-slate-400">{cameraError}</p>}

          <div className="flex flex-wrap gap-2">
            {photo ? (
              <Button variant="outline" onClick={() => { setPhoto(null); setCodes([]); setTerm(""); setError(null); setMatched(null); }} data-testid="scan-retake">
                <RotateCcw className="size-4" /> Retake
              </Button>
            ) : (
              <Button onClick={capture} disabled={!!cameraError} data-testid="scan-capture">
                <Camera className="size-4" /> Scan
              </Button>
            )}
            <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="scan-file">
              <ImageUp className="size-4" /> Take or choose a photo
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void scan(f);
              }}
            />
          </div>

          {error && <p className="text-sm text-amber-300" data-testid="scan-error">{error}</p>}

          {codes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={LABEL}>Found</span>
              {codes.map((c) => (
                <Button key={c} size="xs" variant={c === term ? "default" : "outline"} onClick={() => setTerm(c)}>
                  {c}
                </Button>
              ))}
            </div>
          )}

          {(photo || codes.length > 0) && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                aria-label="Card number, product code or name"
                data-testid="scan-search"
                placeholder="Card number, product code or name"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          )}

          {cardList.length > 0 && (
            <div className="space-y-1.5">
              <p className={LABEL}>{q.length >= 2 ? "Cards — pick the printing" : "Best matches — pick the card"}</p>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {cardList.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-1 rounded-md border border-slate-800 bg-slate-950/40 p-1 text-left hover:border-sky-500"
                      onClick={() => onPickCard(c)}
                      data-testid={`scan-card-${c.id}`}
                    >
                      <img src={c.image_url} alt={c.name} loading="lazy" className="aspect-[63/88] w-full object-cover" style={CARD_CORNERS} />
                      <span className="truncate text-center font-mono text-[0.65rem] text-slate-300">{c.card_no}{c.parallel ? " · Parallel" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {productList.length > 0 && (
            <div className="space-y-1.5">
              <p className={LABEL}>Products</p>
              <ul className="grid gap-1.5">
                {productList.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-1.5 text-left text-sm hover:border-sky-500"
                      onClick={() => onPickProduct(p)}
                      data-testid={`scan-product-${p.id}`}
                    >
                      <img src={p.image_url} alt="" loading="lazy" className="size-12 shrink-0 rounded bg-slate-950 object-contain" />
                      <span className="min-w-0 truncate text-slate-100">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {nothing && <p className="text-sm text-slate-500">Nothing in the database matches “{q}”.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
