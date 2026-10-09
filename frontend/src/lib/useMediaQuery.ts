import { useCallback, useSyncExternalStore } from "react";

/**
 * Live boolean for a CSS media query (e.g. "(min-width: 1024px)").
 * Used to render ONE layout at a time (table vs. mobile list) so data-testids stay unique.
 */
export function useMediaQuery(query: string): boolean {
  // stable per query, so React doesn't re-subscribe on every render
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true, // no window (SSR/tests) → assume desktop
  );
}
