// Reading a photo of a card or a product box: the text in it (OCR) → the codes printed on it.
//   cards:    GD01-001, ST09-010, EB01-005, RP-025, EXB-001, EXRP-015, T-029 …
//   products: ST09, GD01, EB01, PB02, PC01, EVX07 …
// OCR mixes up O/0 and I/l/1, so the number parts are cleaned before matching.

const digits = (s: string) => s.replace(/O/g, "0").replace(/[IL]/g, "1");

// Set codes are often misread too: GD01 → "6001", ST09 → "5709", EB01 → "EBO1"
const FIRST: Record<string, string> = { "6": "G", C: "G", "5": "S", "8": "B" };
const SECOND: Record<string, string> = { "0": "D", O: "D", "7": "T", "8": "B" };
const SET_PREFIXES = new Set(["GD", "ST", "EB"]);
// digits OCR confuses with each other — a misread set number (ST03 for ST09) still finds the card
const LOOKALIKE: Record<string, string[]> = { "0": ["8"], "1": ["7"], "3": ["8", "9"], "5": ["6"], "6": ["5", "8"], "7": ["1"], "8": ["0", "3", "9"], "9": ["3", "8"] };

const SET_CARD_RE = /\b([A-Z0-9]{2})\s?([0-9OIL]{2})\s?[-–—_.]\s?([0-9OIL]{3})\b/g;
const OTHER_CARD_RE = /\b(EXRP|EXBP|EXR|EXB|EX|PR|RP|R|T)\s?[-–—_.]\s?([0-9OIL]{3})\b/g;
const PRODUCT_RE = /\b(EVX|ST|GD|EB|PB|PC|SC)\s?-?\s?([0-9OIL]{1,2})\b/g;

// Codes printed in the photo's text. Card codes come with look-alike variants (the backend picks the
// one whose card fits the rest of the text); the first is the code as read.
export function codesFromText(text: string): { cards: string[]; read: string[]; products: string[] } {
  const t = text.toUpperCase();
  const cards = new Set<string>();
  const read = new Set<string>(); // the card codes as read, without the look-alikes
  const products = new Set<string>();
  for (const m of t.matchAll(SET_CARD_RE)) {
    const prefix = (FIRST[m[1][0]] ?? m[1][0]) + (SECOND[m[1][1]] ?? m[1][1]);
    const set = digits(m[2]);
    const no = digits(m[3]);
    if (!SET_PREFIXES.has(prefix) || !/^\d{2}$/.test(set) || !/^\d{3}$/.test(no)) continue;
    cards.add(`${prefix}${set}-${no}`);
    read.add(`${prefix}${set}-${no}`);
    for (const d of LOOKALIKE[set[1]] ?? []) cards.add(`${prefix}${set[0]}${d}-${no}`);
    products.add(`${prefix}${set}`); // GD01-001 → the GD01 booster too
  }
  for (const m of t.matchAll(OTHER_CARD_RE)) {
    const no = digits(m[2]);
    if (/^\d{3}$/.test(no)) {
      cards.add(`${m[1]}-${no}`);
      read.add(`${m[1]}-${no}`);
    }
  }
  for (const m of t.matchAll(PRODUCT_RE)) {
    const n = digits(m[2]);
    if (/^\d+$/.test(n)) products.add(`${m[1]}${n.padStart(2, "0")}`);
  }
  return { cards: [...cards], read: [...read], products: [...products] };
}

// Grayscale, upscaled copy of the photo (OCR reads small print better when it's larger and plain).
export async function prepareImage(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2400 / Math.max(bitmap.width, bitmap.height), 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't read images.");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// The text in the photo. tesseract.js loads on first use (its engine and English data come from a CDN).
export async function readText(file: Blob, onProgress?: (pct: number) => void): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(await prepareImage(file));
    return data.text;
  } finally {
    await worker.terminate();
  }
}
