import { useEffect, useState } from "react";

// Colour theme picker (bottom-left). Each theme is a palette in index.css
// (:root[data-theme-preview=...]); "graphite" is the original dark look with no attribute.
// Pearl is the default; the choice is remembered in this browser. index.html applies the saved
// theme before the app loads, so the page doesn't flash the wrong colours.
const THEMES = [
  ["pearl", "Pearl (light) · Default"],
  ["pearl-dark", "Pearl (dark)"],
  ["ash", "Ash Crimson (light)"],
  ["ash-dark", "Ash Crimson (dark)"],
  ["frost", "Frost (light)"],
  ["frost-dark", "Frost (dark)"],
  ["overdrive-light", "Overdrive (light)"],
  ["overdrive", "Overdrive (dark)"],
  ["graphite", "Graphite"],
  ["gunmetal", "Gunmetal"],
  ["crimson", "Crimson Night"],
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

export default function ThemePreview() {
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
    <label
      className="flex w-fit items-center lg:fixed lg:bottom-3 lg:left-3 lg:z-50 gap-2 rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-300 shadow-lg"
      data-testid="theme-preview"
    >
      Theme
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100"
        aria-label="Colour theme"
      >
        {THEMES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
