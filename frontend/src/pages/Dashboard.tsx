import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, Toaster } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import FilterBar from "@/components/FilterBar";
import { EMPTY_FILTERS, filtersActive, type InventoryFilters } from "@/components/FilterBar";
import ItemCard from "@/components/ItemCard";
import ItemTable from "@/components/ItemTable";
import StatsStrip from "@/components/StatsStrip";
import ItemFormDialog, { type FormState } from "@/components/ItemFormDialog";
import DealDialog, { type DealState } from "@/components/DealDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Archive,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  Table2,
  LayoutGrid,
} from "lucide-react";
import type { CollectionItem, ItemPayload, StatusPayload, TabId } from "@/lib/types";

const TABS: { id: TabId; label: string; testId: string }[] = [
  { id: "all", label: "All Items", testId: "tab-all" },
  { id: "for_sale", label: "For Sale", testId: "tab-for-sale" },
  { id: "pending", label: "Pending", testId: "tab-pending" },
  { id: "archive", label: "Archive", testId: "tab-archive" },
];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<"grid" | "table">("table");
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [dealState, setDealState] = useState<DealState | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["items"],
    queryFn: () => apiGet<CollectionItem[]>("/items"),
  });
  const todayQuery = useQuery({
    queryKey: ["today"],
    queryFn: () => apiGet<{ today: string }>("/today"),
    staleTime: Infinity,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["items"] });

  const createMut = useMutation({
    mutationFn: (payload: ItemPayload) => apiPost<CollectionItem>("/items", payload),
    onSuccess: (item) => {
      invalidate();
      setFormState(null);
      if (tab === "archive") setTab("all");
      toast.success(`${item.name} added to your ${item.kind === "card" ? "cards" : "items"}`);
    },
    onError: () => toast.error("Could not add the item — please try again"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ItemPayload }) =>
      apiPut<CollectionItem>(`/items/${id}`, payload),
    onSuccess: (item) => {
      invalidate();
      setFormState(null);
      toast.success(`${item.name} updated`);
    },
    onError: () => toast.error("Could not save changes — please try again"),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StatusPayload }) =>
      apiPatch<CollectionItem>(`/items/${id}/status`, payload),
    onSuccess: () => {
      invalidate();
      setDealState(null);
    },
    onError: () => toast.error("Could not update the deal — please try again"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/items/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Item deleted");
    },
    onError: () => toast.error("Could not delete the item — please try again"),
  });

  const items = itemsQuery.data ?? [];

  const tabCounts = useMemo(() => {
    const counts: Record<TabId, number> = { all: 0, for_sale: 0, pending: 0, archive: 0 };
    for (const item of items) {
      if (item.status !== "sold") counts.all += 1;
      if (item.status === "for_sale") counts.for_sale += 1;
      else if (item.status === "pending") counts.pending += 1;
      else counts.archive += 1;
    }
    return counts;
  }, [items]);

  const visible = useMemo(() => {
    const base = items.filter((item) =>
      tab === "archive"
        ? item.status === "sold"
        : tab === "for_sale"
          ? item.status === "for_sale"
          : tab === "pending"
            ? item.status === "pending"
            : item.status !== "sold",
    );
    const q = filters.search.trim().toLowerCase();
    const buyer = filters.buyer.trim().toLowerCase();
    return base.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (filters.color !== "all" && item.color !== filters.color) return false;
      if (filters.cardType !== "all" && item.card_type !== filters.cardType) return false;
      if (filters.rarity !== "all" && item.rarity !== filters.rarity) return false;
      if (buyer && !(item.buyer_name ?? "").toLowerCase().includes(buyer)) return false;
      if (filters.dateFrom && (!item.deal_date || item.deal_date < filters.dateFrom)) return false;
      if (filters.dateTo && (!item.deal_date || item.deal_date > filters.dateTo)) return false;
      return true;
    });
  }, [items, tab, filters]);

  const unmark = (item: CollectionItem) =>
    statusMut.mutate(
      { id: item.id, payload: { status: "for_sale" } },
      { onSuccess: () => toast.success(`${item.name} is back in your inventory`) },
    );

  const deleteItem = (item: CollectionItem) => {
    if (window.confirm(`Delete "${item.name}" permanently? This cannot be undone.`)) {
      deleteMut.mutate(item.id);
    }
  };

  const actionProps = {
    onEdit: (item: CollectionItem) => setFormState({ type: "edit", item }),
    onMarkPending: (item: CollectionItem) => setDealState({ item, target: "pending" }),
    onSell: (item: CollectionItem) => setDealState({ item, target: "sold" }),
    onRestore: unmark,
    onDelete: deleteItem,
    onUnmark: unmark,
  };

  return (
    <div data-testid="dashboard" className="min-h-svh bg-[#0B0F17] text-slate-200">
      {/* HUD top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0B0F17]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex size-9 items-center justify-center rounded-md border border-sky-500/40 bg-sky-950/60 text-sky-300">
            <Rocket className="size-5" aria-hidden />
          </div>
          <div className="mr-auto">
            <h1 className="font-heading text-lg font-bold uppercase tracking-tight text-slate-100">
              Gundam Collection
            </h1>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              Personal inventory &amp; sales tracker
            </p>
          </div>
          <Button
            variant="outline"
            data-testid="add-item-button"
            onClick={() => setFormState({ type: "add", kind: "item" })}
          >
            <Package className="size-4" /> Add Item
          </Button>
          <Button data-testid="add-card-button" onClick={() => setFormState({ type: "add", kind: "card" })}>
            <Plus className="size-4" /> Add Card
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <StatsStrip items={items} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={(value: string) => setTab(value as TabId)}>
            <TabsList>
              {TABS.map(({ id, label, testId }) => (
                <TabsTrigger key={id} value={id} data-testid={testId} className="gap-2">
                  {id === "archive" && <Archive className="size-3.5" aria-hidden />}
                  {label}
                  <span
                    data-testid={`${testId}-count`}
                    className="rounded-sm bg-slate-800 px-1.5 font-mono text-xs tabular-nums text-slate-300"
                  >
                    {tabCounts[id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1 rounded-md border border-slate-800/80 p-1">
            <Button
              size="icon-xs"
              variant={view === "table" ? "secondary" : "ghost"}
              aria-label="Table view"
              title="Table view"
              data-testid="view-table"
              onClick={() => setView("table")}
            >
              <Table2 className="size-4" />
            </Button>
            <Button
              size="icon-xs"
              variant={view === "grid" ? "secondary" : "ghost"}
              aria-label="Grid view"
              title="Grid view"
              data-testid="view-grid"
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="size-4" />
            </Button>
          </div>
        </div>

        <FilterBar filters={filters} onChange={setFilters} />

        {/* Data-dependent region — the shell above always renders, even without the backend. */}
        {itemsQuery.isError ? (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-6 text-center">
            <p className="text-slate-200">Could not load your inventory.</p>
            <Button
              variant="outline"
              className="mt-3"
              data-testid="retry-load"
              onClick={() => itemsQuery.refetch()}
            >
              <RefreshCw className="size-4" /> Retry
            </Button>
          </div>
        ) : itemsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="loading-skeleton">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-48 animate-pulse rounded-lg border border-slate-800/80 bg-slate-900/60" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700/80 px-4 py-12 text-center">
            <Layers className="mx-auto size-8 text-slate-600" aria-hidden />
            {items.length === 0 ? (
              <>
                <p className="mt-3 font-heading text-lg font-bold uppercase tracking-tight text-slate-300">
                  Your inventory is empty
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Add your first card or item to start tracking.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    variant="outline"
                    data-testid="empty-add-item"
                    onClick={() => setFormState({ type: "add", kind: "item" })}
                  >
                    <Package className="size-4" /> Add Item
                  </Button>
                  <Button data-testid="empty-add-card" onClick={() => setFormState({ type: "add", kind: "card" })}>
                    <Plus className="size-4" /> Add Card
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 font-heading text-lg font-bold uppercase tracking-tight text-slate-300">
                  No items match your filters
                </p>
                {filtersActive(filters) && (
                  <Button variant="outline" className="mt-4" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                )}
              </>
            )}
          </div>
        ) : view === "table" ? (
          <ItemTable items={visible} {...actionProps} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <ItemCard key={item.id} item={item} {...actionProps} />
            ))}
          </div>
        )}
      </main>

      {formState && (
        <ItemFormDialog
          state={formState}
          onClose={() => setFormState(null)}
          onSubmit={(payload, id) =>
            id ? updateMut.mutate({ id, payload }) : createMut.mutate(payload)
          }
          pending={createMut.isPending || updateMut.isPending}
        />
      )}

      {dealState && (
        <DealDialog
          state={dealState}
          today={todayQuery.data?.today}
          onClose={() => setDealState(null)}
          onConfirm={(payload, target) => {
            const source = dealState.item;
            const qtySold = payload.quantity_sold ?? source.quantity;
            const partial = target === "sold" && qtySold < source.quantity;
            statusMut.mutate(
              { id: source.id, payload },
              {
                onSuccess: () => {
                  if (partial)
                    toast.success(`${qtySold} of ${source.quantity} ${source.name} sold — moved to Archive`);
                  else if (target === "sold") toast.success(`${source.name} sold — moved to Archive`);
                  else toast.success(`${source.name} marked as pending`);
                },
              },
            );
          }}
          pending={statusMut.isPending}
        />
      )}

      <Toaster richColors />
    </div>
  );
}
