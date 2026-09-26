import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CatalogSyncStatus } from "@/lib/types";
import { Loader2, RefreshCw } from "lucide-react";

/** Which scraped database: the card list (Add Card) or the product list (Add Item). */
export type CatalogKind = "cards" | "products";

const COPY: Record<
  CatalogKind,
  { noun: string; emptyTitle: string; emptyText: string; download: string; testId: string }
> = {
  cards: {
    noun: "cards",
    emptyTitle: "Card database not downloaded yet",
    emptyText:
      "Download every card (GD01 → Promotion cards) with its image from gundam-gcg.com. This takes a few minutes the first time.",
    download: "Download card database",
    testId: "card-sync",
  },
  products: {
    noun: "products",
    emptyTitle: "Product database not downloaded yet",
    emptyText:
      "Download every product (starter decks, accessories, Premium Bandai and other — no booster packs) with its image from gundam-gcg.com.",
    download: "Download product database",
    testId: "product-sync",
  },
};

const STAGE_LABEL: Record<string, string> = {
  starting: "Starting",
  packages: "Reading sets",
  lists: "Listing cards",
  details: "Reading card details",
  pages: "Reading product pages",
  images: "Downloading images",
};

export function useCatalogSync(kind: CatalogKind) {
  return useQuery({
    queryKey: [kind, "sync"],
    queryFn: () => apiGet<CatalogSyncStatus>(`/${kind}/sync`),
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });
}

function useWasRunning(running: boolean) {
  const [was, setWas] = useState(false);
  useEffect(() => {
    if (running) setWas(true);
  }, [running]);
  return was;
}

/**
 * Download / update control for a scraped database.
 * `compact` = one-line "N items · updated … · Update" footer; otherwise the empty-state panel.
 */
export function CatalogSyncPanel({ kind, compact = false }: { kind: CatalogKind; compact?: boolean }) {
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const status = useCatalogSync(kind);
  const start = useMutation({
    mutationFn: () => apiPost<CatalogSyncStatus>(`/${kind}/sync`, { images: true }),
    onSuccess: (data) => queryClient.setQueryData([kind, "sync"], data),
  });
  const s = status.data;
  const wasRunning = useWasRunning(s?.running ?? false);

  // When a sync finishes, refresh any open search results.
  useEffect(() => {
    if (wasRunning && s && !s.running) queryClient.invalidateQueries({ queryKey: [kind, "search"] });
  }, [wasRunning, s, queryClient, kind]);

  if (s?.running) {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return (
      <div
        data-testid={`${copy.testId}-progress`}
        className="space-y-1.5 rounded-md border border-sky-500/30 bg-sky-950/30 px-3 py-2"
      >
        <p className="flex items-center gap-2 text-xs text-sky-200">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {STAGE_LABEL[s.stage ?? "starting"] ?? s.stage} — {s.done}/{s.total}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
        <span>
          Database: {s?.catalog_count ?? 0} {copy.noun}
          {s?.synced_at ? ` · updated ${formatDate(s.synced_at.slice(0, 10))}` : ""}
        </span>
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0 text-xs"
          data-testid={`${copy.testId}-button`}
          onClick={() => start.mutate()}
        >
          <RefreshCw className="size-3" /> Update database
        </Button>
        {s?.error && <span className="text-red-400">Last update failed: {s.error}</span>}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-slate-700 px-4 py-6 text-center">
      <p className="font-heading text-base font-bold uppercase tracking-tight text-slate-200">{copy.emptyTitle}</p>
      <p className="text-sm text-slate-400">{copy.emptyText}</p>
      {s?.error && <p className="text-sm text-red-400">Last attempt failed: {s.error}</p>}
      <Button data-testid={`${copy.testId}-button`} onClick={() => start.mutate()} disabled={start.isPending}>
        <RefreshCw className="size-4" /> {copy.download}
      </Button>
    </div>
  );
}
