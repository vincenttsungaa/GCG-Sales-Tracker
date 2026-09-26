import { useSyncExternalStore } from "react";

/**
 * Live boolean for a CSS media query (e.g. "(min-width: 1024px)").
 * Used to render ONE layout at a time (table vs. mobile list) so data-testids stay unique.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true, // no window (SSR/tests) → assume desktop
  );
}
