import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, Toaster } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import FilterBar from "@/components/FilterBar";
import { EMPTY_FILTERS, filtersActive, type InventoryFilters } from "@/lib/filters";
import ItemCard from "@/components/ItemCard";
import ItemTable from "@/components/ItemTable";
import Pagination from "@/components/Pagination";
import StatsStrip from "@/components/StatsStrip";
import ItemFormDialog, { type FormState } from "@/components/ItemFormDialog";
import DealDialog, { type DealState } from "@/components/DealDialog";
import AddCardDialog from "@/components/AddCardDialog";
import AddItemDialog from "@/components/AddItemDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Archive,
  CheckSquare,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  Table2,
  LayoutGrid,
  Trash2,
  X,
} from "lucide-react";
import type { CollectionItem, ItemPayload, StatusPayload, TabId } from "@/lib/types";

const TABS: { id: TabId; label: string; testId: string }[] = [
  { id: "all", label: "All Items", testId: "tab-all" },
  { id: "for_sale", label: "For Sale", testId: "tab-for-sale" },
  { id: "pending", label: "Pending", testId: "tab-pending" },
  { id: "archive", label: "Sold", testId: "tab-archive" },
];

const PAGE_SIZE = 10;

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS);

  // Buyer filter only applies on the Pending and Sold tabs — clear it elsewhere.
  const showBuyer = tab === "pending" || tab === "archive";
  useEffect(() => {
    if (!showBuyer) setFilters((f) => (f.buyer ? { ...f, buyer: "" } : f));
  }, [showBuyer]);
  const [page, setPage] = useState(1);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [dealState, setDealState] = useState<DealState | null>(null);
  // Select mode: tick several listings and delete them together.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const keepAddItemOpen = useRef(false);
  const createMut = useMutation({
    mutationFn: (payload: ItemPayload) => apiPost<CollectionItem>("/items", payload),
    onSuccess: (item) => {
      invalidate();
      setFormState(null);
      setAddCardOpen(false);
      // an item listed on its own while a bundle is being built keeps Add Item open
      if (keepAddItemOpen.current) keepAddItemOpen.current = false;
      else setAddItemOpen(false);
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

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => apiPost<{ deleted: number }>("/items/bulk-delete", { ids }),
    onSuccess: ({ deleted }) => {
      invalidate();
      setSelectedIds(new Set());
      setSelecting(false);
      toast.success(`${deleted} ${deleted === 1 ? "listing" : "listings"} deleted`);
    },
    onError: () => toast.error("Could not delete the selected listings — please try again"),
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

  // Pagination — 10 per page. Back to page 1 whenever the tab or filters change.
  useEffect(() => {
    setPage(1);
  }, [tab, filters]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount); // e.g. after deleting the last item on the last page
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Keep the selection to listings still shown (after a tab / filter change or a delete).
  useEffect(() => {
    setSelectedIds((cur) => {
      const shown = new Set(visible.map((i) => i.id));
      const kept = [...cur].filter((id) => shown.has(id));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [visible]);
  const toggleSelect = (item: CollectionItem) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  const selectAll = (list: CollectionItem[]) =>
    setSelectedIds((cur) => new Set([...cur, ...list.map((i) => i.id)]));
  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };
  const deleteSelected = () => {
    const chosen = visible.filter((i) => selectedIds.has(i.id));
    if (chosen.length === 0) return;
    const names = chosen.slice(0, 8).map((i) => `• ${i.name}`).join("\n");
    const more = chosen.length > 8 ? `\n…and ${chosen.length - 8} more` : "";
    const what = `${chosen.length} ${chosen.length === 1 ? "listing" : "listings"}`;
    if (window.confirm(`Delete ${what} permanently? This cannot be undone.\n\n${names}${more}`)) {
      bulkDeleteMut.mutate(chosen.map((i) => i.id));
    }
  };

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
    selecting,
    isSelected: (item: CollectionItem) => selectedIds.has(item.id),
    onToggleSelect: toggleSelect,
  };

  return (
    <div data-testid="dashboard" className="min-h-svh bg-[#0B0F17] text-slate-200">
      {/* HUD top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0B0F17]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sky-500/40 bg-sky-950/60 text-sky-300">
            <Rocket className="size-5" aria-hidden />
          </div>
          <div className="mr-auto min-w-0">
            <h1 className="truncate font-heading text-base font-bold uppercase tracking-tight text-slate-100 sm:text-lg">
              Gundam Collection
            </h1>
            <p className="hidden font-mono text-xs uppercase tracking-wider text-slate-500 sm:block">
              Personal inventory &amp; sales tracker
            </p>
          </div>
          <Button
            variant="outline"
            aria-label="Add Item"
            data-testid="add-item-button"
            onClick={() => setAddItemOpen(true)}
          >
            <Package className="size-4" /> <span className="hidden sm:inline">Add Item</span>
            <span className="sm:hidden">Item</span>
          </Button>
          <Button
            aria-label="Add Card"
            data-testid="add-card-button"
            onClick={() => setAddCardOpen(true)}
          >
            <Plus className="size-4" /> <span className="hidden sm:inline">Add Card</span>
            <span className="sm:hidden">Card</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-6">
        <StatsStrip items={items} />

        <div className="flex items-center justify-between gap-3">
          {/* Tabs scroll sideways on narrow screens instead of overflowing the page. */}
          <div className="-ml-4 min-w-0 flex-1 overflow-x-auto pl-4 [scrollbar-width:none] sm:ml-0 sm:pl-0">
          <Tabs value={tab} onValueChange={(value: string) => setTab(value as TabId)}>
            <TabsList className="w-max">
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
          </div>
          <Button
            size="sm"
            variant={selecting ? "secondary" : "outline"}
            className="shrink-0"
            data-testid="select-mode"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            <CheckSquare className="size-4" /> {selecting ? "Done" : "Select"}
          </Button>
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-800/80 p-1">
            <Button
              size="icon-xs"
              variant={view === "table" ? "secondary" : "ghost"}
              aria-label="List view"
              title="List view"
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

        <FilterBar filters={filters} onChange={setFilters} showBuyer={showBuyer} />

        {/* Select mode: tick listings, then delete them together */}
        {selecting && (
          <div
            data-testid="selection-bar"
            className="sticky top-16 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-500/40 bg-[#0f1a2a]/95 px-3 py-2 backdrop-blur"
          >
            <span className="font-mono text-sm text-slate-200" data-testid="selection-count">
              {selectedIds.size} selected
            </span>
            <Button variant="link" size="xs" className="h-auto px-0" onClick={() => selectAll(pageItems)}>
              Select all on page
            </Button>
            {visible.length > pageItems.length && (
              <Button variant="link" size="xs" className="h-auto px-0" onClick={() => selectAll(visible)}>
                Select all ({visible.length})
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                data-testid="delete-selected"
                disabled={selectedIds.size === 0 || bulkDeleteMut.isPending}
                onClick={deleteSelected}
              >
                <Trash2 className="size-4" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={stopSelecting} aria-label="Cancel selecting">
                <X className="size-4" /> Cancel
              </Button>
            </span>
          </div>
        )}

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="loading-skeleton">
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="aspect-[63/110] animate-pulse rounded-xl border border-slate-800/80 bg-slate-900/60" />
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
                    onClick={() => setAddItemOpen(true)}
                  >
                    <Package className="size-4" /> Add Item
                  </Button>
                  <Button data-testid="empty-add-card" onClick={() => setAddCardOpen(true)}>
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
        ) : (
          <div className="space-y-4">
            {view === "table" ? (
              <ItemTable items={pageItems} {...actionProps} />
            ) : (
              <div data-testid="item-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {pageItems.map((item) => (
                  <ItemCard key={item.id} item={item} {...actionProps} />
                ))}
              </div>
            )}
            {visible.length > PAGE_SIZE && (
              <Pagination
                page={currentPage}
                pageCount={pageCount}
                pageSize={PAGE_SIZE}
                total={visible.length}
                onPageChange={setPage}
              />
            )}
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

      {addCardOpen && (
        <AddCardDialog
          onClose={() => setAddCardOpen(false)}
          onSubmit={(payload) => createMut.mutate(payload)}
          onManual={() => {
            setAddCardOpen(false);
            setFormState({ type: "add", kind: "card" });
          }}
          pending={createMut.isPending}
        />
      )}

      {addItemOpen && (
        <AddItemDialog
          onClose={() => setAddItemOpen(false)}
          onSubmit={(payload, options) => {
            keepAddItemOpen.current = !!options?.keepOpen;
            createMut.mutate(payload, {
              onSuccess: () => options?.onDone?.(),
              onError: () => {
                keepAddItemOpen.current = false;
              },
            });
          }}
          onManual={() => {
            setAddItemOpen(false);
            setFormState({ type: "add", kind: "item" });
          }}
          pending={createMut.isPending}
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
                    toast.success(`${qtySold} of ${source.quantity} ${source.name} sold — moved to Sold`);
                  else if (target === "sold") toast.success(`${source.name} sold — moved to Sold`);
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
