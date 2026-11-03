import { useEffect, useState } from "react";

// Colour themes. Each is a palette in index.css (:root[data-theme-preview=...]); "graphite" is the
// original dark look with no attribute. Pearl is the default; the choice is remembered in this
// browser, and index.html applies it before the app loads so the page doesn't flash the wrong colours
// (keep its list in step with this one). Picked on the Account page.
// swatch: background, panel, accent — for the preview cards
export const THEMES = [
  ["pearl", "Pearl (light) · Default", ["#eef1f5", "#ffffff", "#4a6a94"]],
  ["pearl-dark", "Pearl (dark)", ["#151a22", "#1e2530", "#8fb3e3"]],
  ["ash", "Ash Crimson (light)", ["#dcdfe0", "#f3f4f4", "#9b1b21"]],
  ["ash-dark", "Ash Crimson (dark)", ["#1a1b1d", "#25272a", "#e5484f"]],
  ["frost", "Frost (light)", ["#e8f1f7", "#ffffff", "#0e8fb3"]],
  ["frost-dark", "Frost (dark)", ["#0e171d", "#15222b", "#4fc8ea"]],
  ["overdrive-light", "Overdrive (light)", ["#f3eff9", "#ffffff", "#c2185b"]],
  ["overdrive", "Overdrive (dark)", ["#171021", "#241933", "#ff5fa2"]],
  ["graphite", "Graphite", ["#2a2d31", "#3a3e44", "#e8a93a"]],
  ["gunmetal", "Gunmetal", ["#1b1d21", "#262a2f", "#e8a93a"]],
  ["crimson", "Crimson Night", ["#161112", "#231a1b", "#e0b14d"]],
] as const;
const THEME_KEY = "cardstakk:theme";
const DEFAULT_THEME = "pearl";

function saved(): string {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && THEMES.some(([k]) => k === v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The theme picker on the Account page: a card per theme with its colours. */
export default function ThemePicker() {
  const [theme, setTheme] = useState(saved);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "graphite") delete root.dataset.themePreview;
    else root.dataset.themePreview = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private window: just don't remember it */
    }
  }, [theme]);
  return (
    <div role="radiogroup" aria-label="Colour theme" className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" data-testid="theme-picker">
      {THEMES.map(([value, label, colours]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={`overflow-hidden rounded-md border text-left text-xs ${
            theme === value ? "border-[var(--rt-amber)] ring-2 ring-[var(--rt-amber)]" : "border-[var(--rt-line)] hover:border-[var(--rt-label)]"
          }`}
        >
          <span className="flex h-11" aria-hidden>
            {colours.map((c) => (
              <span key={c} className="flex-1" style={{ background: c }} />
            ))}
          </span>
          <span className={`block bg-[var(--rt-panel)] px-2.5 py-2 ${theme === value ? "font-bold" : ""}`}>{label}</span>
        </button>
      ))}
    </div>
  );
}
