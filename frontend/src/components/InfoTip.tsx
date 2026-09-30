import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

const WIDTH = 256;
const MARGIN = 8; // keep the bubble this far inside the window
const GAP = 6; // space between the icon and the bubble

// The tip bubble is styled inline so it looks the same whatever utility classes are built.
const BUBBLE: CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  padding: "8px 12px",
  borderRadius: 0,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e2e8f0",
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: 1.5,
  fontWeight: 400,
  letterSpacing: "normal",
  textTransform: "none",
  textAlign: "left",
  whiteSpace: "normal",
  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.45)",
  pointerEvents: "none",
};

// A small (i) that shows a tip while it's hovered or focused (keyboard). The bubble is drawn on
// top of the page (not inside the dialog, which would crop it) and kept inside the window: it
// shifts left near the right edge and opens above the icon when there's no room below.
export function InfoTip({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const place = useCallback(() => {
    const icon = iconRef.current?.getBoundingClientRect();
    if (!icon) return;
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(icon.left, MARGIN), window.innerWidth - width - MARGIN);
    const height = bubbleRef.current?.offsetHeight ?? 0;
    const below = icon.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN ? Math.max(icon.top - GAP - height, MARGIN) : below;
    setPos({ left, top, width });
  }, []);

  // position on open, again once the bubble's height is known, and while scrolling / resizing
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span
      style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        ref={iconRef}
        tabIndex={0}
        role="button"
        aria-label={label}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // inside a <label>: don't move focus to its input. Opening only (focus / hover open it
          // too, so a toggle here would close it again straight away).
          e.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        style={{ display: "inline-flex", cursor: "help", color: open ? "#7dd3fc" : "#64748b", borderRadius: 999 }}
      >
        <Info style={{ width: 14, height: 14 }} aria-hidden />
      </span>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            style={{
              ...BUBBLE,
              width: pos?.width ?? WIDTH,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

// Wraps text that can be cut off (e.g. a name clamped to two lines): while it's hovered, and only
// if it is actually cut off, the full text shows in a bubble just above it (below when there's
// no room above), drawn on top of the page like the (i) tips.
export function OverflowTip({ text, children }: { text: string; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 200), 320, window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(r.left, MARGIN), window.innerWidth - width - MARGIN);
    const height = bubbleRef.current?.offsetHeight ?? 0;
    const above = r.top - GAP - height;
    const top = above >= MARGIN ? above : Math.min(r.bottom + GAP, window.innerHeight - height - MARGIN);
    setPos({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const frame = requestAnimationFrame(place);
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, place]);

  // cut off = the clamped element inside has more content than it shows
  const isCut = () => {
    const el = wrapRef.current?.firstElementChild as HTMLElement | null;
    return !!el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  };

  return (
    <div ref={wrapRef} onMouseEnter={() => isCut() && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            role="tooltip"
            style={{
              ...BUBBLE,
              fontSize: 13,
              fontWeight: 600,
              color: "#f1f5f9",
              width: pos?.width ?? 320,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </div>
  );
}

const ZOOM_MAX_W = 320;
const ZOOM_MAX_H = 450;

// A small photo that shows a big copy of itself while it's hovered — beside it (right, or left
// when there's no room), kept inside the window and drawn on top of the page.
export function HoverZoom({ src, alt, children }: { src: string; alt: string; children: ReactNode }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bigRef = useRef<HTMLImageElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    const big = bigRef.current;
    if (!r || !big || !big.complete || big.naturalWidth === 0) return;
    const w = big.offsetWidth;
    const h = big.offsetHeight;
    const right = r.right + GAP * 2;
    const left = right + w <= window.innerWidth - MARGIN ? right : Math.max(r.left - GAP * 2 - w, MARGIN);
    const top = Math.min(Math.max(r.top + r.height / 2 - h / 2, MARGIN), window.innerHeight - h - MARGIN);
    setPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, place]);

  return (
    <span
      ref={wrapRef}
      style={{ display: "inline-flex", flexShrink: 0, cursor: "zoom-in" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <img
            ref={bigRef}
            src={src}
            alt={alt}
            aria-hidden
            onLoad={place}
            style={{
              position: "fixed",
              zIndex: 1000,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? "visible" : "hidden",
              width: "auto",
              height: "auto",
              maxWidth: `min(${ZOOM_MAX_W}px, calc(100vw - ${MARGIN * 2}px))`,
              maxHeight: `min(${ZOOM_MAX_H}px, calc(100vh - ${MARGIN * 2}px))`,
              borderRadius: 0,
              border: "1px solid #334155",
              background: "#0f172a",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
              pointerEvents: "none",
            }}
          />,
          document.body,
        )}
    </span>
  );
}
