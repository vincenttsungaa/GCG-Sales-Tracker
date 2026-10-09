// Product photos "cut out" of their backgrounds, so they float on the item tile's backdrop.
//
// Done in the browser: the photo is drawn on a canvas and its background removed by flood-filling
// from the edges. Then:
//  • tinted backgrounds (pale aqua product shots): leftover hexagons that don't touch the edge are
//    cleared, and kept islands whose colour matches the background are dropped;
//  • white backgrounds: the fill also stops at any sharp colour step, so white products keep their
//    outline, and a product whose white faces were still eaten through a gap is filled back in to
//    its convex outline.
// Results are cached for the session; if a photo can't be processed (or nothing would change)
// the original photo is used. Cut-outs run one at a time, yielding between photos, so a page
// full of tiles doesn't freeze the UI.
// ponytail: still on the main thread (~tens of ms per photo); move makeCutout to a Worker with
// OffscreenCanvas if a single photo ever stalls scrolling.

const MAX_SIDE = 600;
const EDGE_TOLERANCE = 34; // sum of |ΔR|+|ΔG|+|ΔB| from the edge colour that still counts as background
const WHITE_TOLERANCE = 30;
const WHITE_STEP = 9; // white backgrounds: largest colour step between neighbouring background pixels
const AQUA_STEP = 12;
const HEX_TOLERANCE = 16;
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

// Photos the automatic cut-out can't separate cleanly — Premium Bandai / Edition Beta parts (white
// products shot on white) and the official shots of flat sleeves and card collections (whose pale
// sleeves and cards blend into the aqua backdrop). These were cut out ahead of time (an AI background
// remover for the boxes, exact rectangles for sleeves, cards and playmats) and live in
// public/cutouts/<photo name>.webp.
const PREMADE = new Set([
  "evx05",
  "evx12",
  "evx13",
  "limitedbox-beta-part-booster-pack",
  "limitedbox-beta-part-damage-counter-dice",
  "limitedbox-beta-part-storage-box",
  "pc01a-part-assemble-cgs-mobile-worker",
  "pc01a-part-assemble-graze-custom",
  "pc01a-part-assemble-gundam-barbatos-4th-form",
  "pc02a-part-assemble-gfred",
  "pc02a-part-assemble-gquuuuuux-omega-psycommu",
  "pc02a-part-assemble-red-gundam",
  "pb01-part-deck-box",
  "pb01-part-separator",
  "pb01-part-playmat",
  "pb01-part-sleeves",
  "pb01-part-storage-box",
  "pb02-part-deck-box",
  "pb02-part-separator",
  "pb02-part-playmat",
  "pb02-part-sleeves",
  "pb02-part-storage-box",
  "pb03-part-card-case",
  "st01-part-assemble-gundam",
  "st01-part-assemble-guncannon",
  "st01-part-assemble-guntank",
  "st02-part-assemble-leo-a",
  "st02-part-assemble-leo-b",
  "st02-part-assemble-tallgeese",
  "st03-part-assemble-char-s-zaku-ii",
  "st03-part-assemble-zaku-ii-a",
  "st03-part-assemble-zaku-ii-b",
  "st04-part-assemble-launcher-strike-gundam",
  "st04-part-assemble-skygrasper",
  "st04-part-assemble-sword-strike-gundam",
  "pb03-part-damage-counter-dice",
  "pb03-part-playmat",
  "pb03-part-sleeves-blue",
  "pb03-part-sleeves-green",
  "pb03-part-storage-box",
]);
const PREMADE_RE = /\/api\/product-images\/([a-z0-9-]+)\.(?:svg|webp)(?:\?|$)/;

// Sleeve-design pictures (…-sleeves.svg?designs=a,b) are flat artwork that fills the picture, so
// they're shown as they are — except these designs, which are product photos on white.
const PHOTO_DESIGNS = new Set(["deck-case", "separator", "playmat", "storage-box", "storage-box-1", "storage-box-2", "storage-box-3", "deck-box", "dice", "case"]);
const DESIGNS_RE = /-sleeves\.svg\?(?:.*&)?designs=([^&]+)/;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

function neighbours(p: number, w: number, n: number): number[] {
  const x = p % w;
  return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
}

// Connected groups of kept (not removed) pixels.
function islands(removed: Uint8Array, w: number, n: number): number[][] {
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  for (let start = 0; start < n; start++) {
    if (removed[start] || seen[start]) continue;
    const px = [start];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      for (const q of neighbours(p, w, n)) {
        if (q >= 0 && !removed[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
          px.push(q);
        }
      }
    }
    out.push(px);
  }
  return out;
}

// Convex hull of an island (from each row's leftmost and rightmost pixel).
function hullOf(px: number[], w: number): [number, number][] {
  const rows = new Map<number, [number, number]>();
  for (const p of px) {
    const y = Math.floor(p / w), x = p % w;
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else {
      if (x < r[0]) r[0] = x;
      if (x > r[1]) r[1] = x;
    }
  }
  const pts: [number, number][] = [];
  for (const [y, [a, b]] of rows) pts.push([a, y], [b, y]);
  pts.sort((A, B) => A[0] - B[0] || A[1] - B[1]);
  const cross = (O: number[], A: number[], B: number[]) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lo: [number, number][] = [];
  const hi: [number, number][] = [];
  for (const P of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P) <= 0) lo.pop();
    lo.push(P);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const P = pts[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], P) <= 0) hi.pop();
    hi.push(P);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

async function makeCutout(src: string): Promise<string | null> {
  const img = await loadImage(src);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || MAX_SIDE) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || MAX_SIDE) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h); // throws for cross-origin images → original is used
  const data = image.data;
  const n = w * h;
  const removed = new Uint8Array(n);

  // Flood fill from `seed`: every connected pixel within `tol` of the seed colour, moving only
  // through colour steps of at most `step`.
  const flood = (seed: number, tol: number, step: number) => {
    if (removed[seed]) return;
    const r0 = data[seed * 4], g0 = data[seed * 4 + 1], b0 = data[seed * 4 + 2];
    const stack = [seed];
    removed[seed] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const pi = p * 4;
      for (const q of neighbours(p, w, n)) {
        if (q < 0 || removed[q]) continue;
        const i = q * 4;
        if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > tol) continue;
        if (Math.abs(data[i] - data[pi]) + Math.abs(data[i + 1] - data[pi + 1]) + Math.abs(data[i + 2] - data[pi + 2]) > step) continue;
        removed[q] = 1;
        stack.push(q);
      }
    }
  };

  // 1. background touching the edges — is it plain white (or near-white grey)?
  const seeds: number[] = [];
  for (let x = 0; x < w; x += 4) seeds.push(x, n - w + x);
  for (let y = 0; y < h; y += 4) seeds.push(y * w, y * w + w - 1);
  let er = 0, eg = 0, eb = 0;
  for (const p of seeds) {
    er += data[p * 4];
    eg += data[p * 4 + 1];
    eb += data[p * 4 + 2];
  }
  const m0 = seeds.length;
  const bright = (er + eg + eb) / (3 * m0);
  const tint = (Math.max(er, eg, eb) - Math.min(er, eg, eb)) / m0;
  // photos that are already cut out (transparent edges), or that have no plain background at all
  // (art that runs to the edge, like a sleeve design) are shown as they are
  let clear = 0, near = 0;
  for (const p of seeds) {
    const i = p * 4;
    if (data[i + 3] < 20) clear++;
    if (Math.abs(data[i] - er / m0) + Math.abs(data[i + 1] - eg / m0) + Math.abs(data[i + 2] - eb / m0) < 45) near++;
  }
  const dark = bright < 70 && tint < 14; // black studio backdrop (may be vignetted, so not uniform)
  if (clear > m0 * 0.3 || (!dark && near < m0 * 0.7)) return src;
  const white = bright > 200 && tint < 14;
  const aqua = !white && bright > 170 && eb - er > 8 * m0 && eg - er > 4 * m0; // the official product shots
  if (!white && !aqua && !dark) return src;
  // (on white and aqua the fill also stops at sharp colour steps, so pale products keep their outline)
  for (const p of seeds) flood(p, white ? WHITE_TOLERANCE : EDGE_TOLERANCE, white ? WHITE_STEP : aqua ? AQUA_STEP : Infinity);

  // the most common background colours
  const counts = new Map<number, number>();
  for (let p = 0; p < n; p += 3) {
    if (!removed[p]) continue;
    const i = p * 4;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);

  // 2. tinted backgrounds: leftover aqua hexagons that don't touch the edge
  if (aqua) {
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const p = y * w + x;
        if (removed[p]) continue;
        const i = p * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (b - r <= 10 || g - r <= 6) continue; // only aqua-tinted pixels — product whites stay
        if (palette.some(([pr, pg, pb]) => (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2 < 24 ** 2)) flood(p, HEX_TOLERANCE, Infinity);
      }
    }
  }

  // 3. drop leftover specks: tiny islands, and small islands in the background's colours
  const groups = islands(removed, w, n);
  const biggest = Math.max(1, ...groups.map((g) => g.length));
  for (const px of groups) {
    let sr = 0, sg = 0, sb = 0;
    for (const p of px) {
      sr += data[p * 4];
      sg += data[p * 4 + 1];
      sb += data[p * 4 + 2];
    }
    const m = px.length;
    const bgColoured = palette.some(([a, b, c]) => Math.abs(sr / m - a) + Math.abs(sg / m - b) + Math.abs(sb / m - c) < 60);
    const drop = m < Math.max(60, n * 0.004) || m < biggest * 0.015 || (bgColoured && m < biggest * 0.25);
    if (drop) for (const p of px) removed[p] = 1;
  }

  // 4. light backgrounds: a product whose light parts were eaten (white on white, or pale areas that
  //    match the aqua backdrop) is filled back in to its convex shape. On white, only when much
  //    was eaten — so the gaps between a cluster of dice stay open.
  //    On aqua, the outline comes from the product's own colours only, so a backdrop hexagon touching
  //    the product isn't pulled in.
  if (white || aqua) {
    let shapes = islands(removed, w, n);
    const core = new Uint8Array(n);
    if (aqua) {
      for (let p = 0; p < n; p++) {
        const i = p * 4;
        const tinted = data[i + 2] - data[i] > 6 && data[i + 1] - data[i] > 4; // aqua, not product white
        core[p] = removed[p] || (tinted && palette.some(([a, b, c]) => Math.abs(data[i] - a) + Math.abs(data[i + 1] - b) + Math.abs(data[i + 2] - c) < 40)) ? 1 : 0;
      }
      shapes = islands(core, w, n).filter((px) => px.length >= Math.max(60, n * 0.004));
      removed.fill(1);
    }
    for (const px of shapes) {
      const hull = hullOf(px, w);
      if (hull.length < 3) continue;
      let area = 0;
      for (let i = 0; i < hull.length; i++) {
        const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
        area += x1 * y2 - x2 * y1;
      }
      const ratio = px.length / Math.max(1, Math.abs(area) / 2);
      if (white && (ratio > 0.8 || ratio < 0.25)) continue;
      const ys = hull.map(([, y]) => y);
      for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
        const xs: number[] = [];
        for (let i = 0; i < hull.length; i++) {
          const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
          if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
        if (xs.length < 2) continue;
        for (let x = Math.ceil(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++) removed[y * w + x] = 0;
      }
    }
    // …but larger stretches of backdrop that reach the outline (the gaps between several products
    // in one shot) are backdrop, not product
    if (aqua) {
      const notBg = new Uint8Array(n);
      for (let p = 0; p < n; p++) notBg[p] = removed[p] || !core[p] ? 1 : 0;
      for (const px of islands(notBg, w, n)) {
        if (px.length < n * 0.008) continue;
        const open = px.some((p) => neighbours(p, w, n).some((q) => q < 0 || removed[q]));
        if (open) for (const p of px) removed[p] = 1;
      }
    }
  }

  // nothing (or almost everything) removed: keep the original photo
  let kept = 0;
  for (let p = 0; p < n; p++) if (!removed[p]) kept++;
  const keptRatio = kept / n;
  if (keptRatio > 0.97) return src;
  if (keptRatio < 0.08) return null;

  // alpha: removed pixels transparent, with a softened 1px edge
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let a = 255;
      if (removed[p]) a = 0;
      else if (
        (x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1]) || (y > 0 && removed[p - w]) || (y < h - 1 && removed[p + w])
      )
        a = 110; // edge pixel: half-transparent to hide the halo
      data[p * 4 + 3] = a;
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  ctx.putImageData(image, 0, 0);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")?.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : null; // kept for the session, like the cache entry
}

/**
 * The picture to float on the tile's backdrop: a cut-out of the product photo, or the photo itself
 * when it has no background to remove. null when it couldn't be processed (the photo is shown as is).
 */
export function cutoutPhoto(src: string): Promise<string | null> {
  const designs = DESIGNS_RE.exec(src)?.[1];
  if (designs && !decodeURIComponent(designs).split(",").some((d) => PHOTO_DESIGNS.has(d))) return Promise.resolve(src);
  const name = PREMADE_RE.exec(src)?.[1];
  if (name && PREMADE.has(name)) return Promise.resolve(`/cutouts/${name}.webp`);
  let job = cache.get(src);
  if (!job) {
    job = queue
      .then(() => new Promise((r) => setTimeout(r))) // let the page paint between photos
      .then(() => makeCutout(src))
      .catch(() => {
        cache.delete(src); // a failed load (offline, 404) is retried next time
        return null;
      });
    queue = job;
    cache.set(src, job);
  }
  return job;
}
