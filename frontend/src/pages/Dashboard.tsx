import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Archive,
  ArrowDownUp,
  FileSpreadsheet,
  Download,
  Mail,
  Share2,
  Loader2,
  CheckSquare,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Table2,
  LayoutGrid,
  Trash2,
  X,
} from "lucide-react";
import type { BundleEntry, CollectionItem, ItemPayload, StatusPayload, TabId } from "@/lib/types";

const TABS: { id: TabId; label: string; testId: string }[] = [
  { id: "all", label: "All Items", testId: "tab-all" },
  { id: "for_sale", label: "For Sale", testId: "tab-for-sale" },
  { id: "pending", label: "Pending", testId: "tab-pending" },
  { id: "on_hold", label: "Storage", testId: "tab-storage" },
  { id: "archive", label: "Sold", testId: "tab-archive" },
];

const PAGE_SIZE = 10;

// Footer / About text and links
const DISCLAIMER =
  "CardStakk is an unofficial, fan-made tool for tracking a personal collection and sales. It is not affiliated with, endorsed or sponsored by Bandai, BANDAI NAMCO, SOTSU or SUNRISE. GUNDAM, the GUNDAM CARD GAME and all related names, card images and product photos are trademarks and copyrights of their respective owners and are shown for identification only. Prices are your own entries, not market values.";
const FEEDBACK_URL = "https://github.com/vincenttsungaa/GCG-Sales-Tracker/issues/new";

// Sort: newest / oldest first, or one category of item first (then newest).
type SortId = "newest" | "oldest" | "cards" | "starter deck" | "accessories" | "premium bandai" | "other";
const SORT_OPTIONS: { value: SortId; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "cards", label: "Cards" },
  { value: "starter deck", label: "Starter Decks" },
  { value: "accessories", label: "Accessories" },
  { value: "premium bandai", label: "Premium Bandai" },
  { value: "other", label: "Others" },
];
const SORT_KEY = "cardstakk:sort";
function savedSort(): SortId {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORT_OPTIONS.some((o) => o.value === v) ? (v as SortId) : "newest";
  } catch {
    return "newest";
  }
}
// "Cards": cards; "Others": items in the Other category (or none); the rest: items in that category.
const inSortGroup = (item: CollectionItem, sort: SortId) =>
  sort === "cards"
    ? item.kind === "card"
    : item.kind === "item" && (sort === "other" ? item.category === "other" || !item.category : item.category === sort);

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS);
  const [sort, setSortState] = useState<SortId>(savedSort);
  const setSort = (s: SortId) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  };

  // Buyer and deal-date filters only apply on the Pending and Sold tabs — clear them elsewhere.
  const showBuyer = tab === "pending" || tab === "archive";
  useEffect(() => {
    if (!showBuyer)
      setFilters((f) => (f.buyer || f.dateFrom || f.dateTo ? { ...f, buyer: "", dateFrom: "", dateTo: "" } : f));
  }, [showBuyer]);
  const [page, setPage] = useState(1);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  // A bundle being built in Add Item / Add Card (products and cards), listed as one item.
  const [bundle, setBundle] = useState<BundleEntry[]>([]);
  const listBundle = (payload: ItemPayload) => createMut.mutate(payload, { onSuccess: () => setBundle([]) });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
    const counts: Record<TabId, number> = { all: 0, for_sale: 0, pending: 0, on_hold: 0, archive: 0 };
    for (const item of items) {
      if (item.status !== "sold") counts.all += 1;
      if (item.status === "for_sale") counts.for_sale += 1;
      else if (item.status === "pending") counts.pending += 1;
      else if (item.status === "on_hold") counts.on_hold += 1;
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
            : tab === "on_hold"
              ? item.status === "on_hold"
              : item.status !== "sold",
    );
    const q = filters.search.trim().toLowerCase();
    const buyer = filters.buyer.trim().toLowerCase();
    const filtered = base.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (filters.color !== "all" && item.color !== filters.color) return false;
      if (filters.cardType !== "all" && item.card_type !== filters.cardType) return false;
      if (filters.rarity !== "all" && item.rarity !== filters.rarity) return false;
      if (buyer && !(item.buyer_name ?? "").toLowerCase().includes(buyer)) return false;
      if (filters.dateFrom && (!item.deal_date || item.deal_date < filters.dateFrom)) return false;
      if (filters.dateTo && (!item.deal_date || item.deal_date > filters.dateTo)) return false;
      return true;
    });
    const time = (item: CollectionItem) => Date.parse(item.created_at) || 0;
    return filtered.sort((a, b) => {
      if (sort !== "newest" && sort !== "oldest") {
        const ga = inSortGroup(a, sort) ? 0 : 1;
        const gb = inSortGroup(b, sort) ? 0 : 1;
        if (ga !== gb) return ga - gb;
      }
      return sort === "oldest" ? time(a) - time(b) : time(b) - time(a);
    });
  }, [items, tab, filters, sort]);

  // Pagination — 10 per page. Back to page 1 whenever the tab or filters change.
  useEffect(() => {
    setPage(1);
  }, [tab, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount); // e.g. after deleting the last item on the last page
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // shared by the page controls above and below the list
  const paginationProps = {
    page: currentPage,
    pageCount,
    pageSize: PAGE_SIZE,
    total: visible.length,
    onPageChange: (p: number) => {
      // leave the clicked page button, so the browser doesn't keep it in view
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setPage(p);
    },
  };

  // Changing page: back to the top once the new page has been drawn (not on the first load).
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    // straight after the new page is in place, before it's shown — an instant jump, nothing to interrupt
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [currentPage]);

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

  const hold = (item: CollectionItem) =>
    statusMut.mutate(
      { id: item.id, payload: { status: "on_hold" } },
      { onSuccess: () => toast.success(`${item.name} moved to storage`) },
    );

  const deleteItem = (item: CollectionItem) => {
    if (window.confirm(`Delete "${item.name}" permanently? This cannot be undone.`)) {
      deleteMut.mutate(item.id);
    }
  };

  const actionProps = {
    onEdit: (item: CollectionItem) => setFormState({ type: "edit", item }),
    onMarkPending: (item: CollectionItem) => setDealState({ item, target: "pending" }),
    onHold: hold,
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
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          {/* app icon (same as the browser tab icon): two fanned cards with a star */}
          <img src="/favicon.svg" alt="" aria-hidden className="size-9 shrink-0" data-testid="app-logo" />
          <div className="mr-auto min-w-0">
            <h1 className="truncate font-heading text-base font-bold tracking-tight text-slate-100 sm:text-lg">
              CardStakk
            </h1>
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

      {/* Wide screens: stats and filters in a sidebar on the left, the listings on the right.
          Narrower screens: one column (stats, tabs, filters, listings) — the sidebar and the
          right column use display:contents there, and `order` keeps that sequence. */}
      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:gap-6">
        {/* Sidebar stays put while the listings scroll: it sticks at exactly where it starts
            (header 69px + the page's 24px top padding), so it doesn't shift on scroll. */}
        <aside
          data-testid="sidebar"
          className="contents lg:sticky lg:top-[93px] lg:flex lg:max-h-[calc(100svh-109px)] lg:w-72 lg:shrink-0 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:[scrollbar-width:thin]"
        >
          <div className="order-1 lg:order-none">
            <StatsStrip items={items} />
          </div>
          <div className="order-3 lg:order-none">
            <FilterBar filters={filters} onChange={setFilters} showBuyer={showBuyer} />
          </div>
        </aside>

        <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-5">
        <div className="order-2 flex items-center justify-between gap-3 lg:order-none">
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
            variant="outline"
            className="shrink-0"
            data-testid="export-open"
            onClick={() => setExportOpen(true)}
            title="Export to Excel"
          >
            <FileSpreadsheet className="size-4" /> <span className="hidden sm:inline">Export</span>
          </Button>
          <Select value={sort} onValueChange={(value) => value && setSort(value as SortId)} items={SORT_OPTIONS}>
            <SelectTrigger
              size="sm"
              data-testid="sort-select"
              aria-label="Sort listings"
              className="h-8 w-auto shrink-0 gap-1.5 bg-slate-950/60"
            >
              <ArrowDownUp className="size-3.5 text-slate-400" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} data-testid={`sort-${o.value.replace(/\s+/g, "-")}`}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

        <div className="order-4 min-w-0 space-y-4 sm:space-y-5 lg:order-none">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" data-testid="loading-skeleton">
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
            {visible.length > PAGE_SIZE && <Pagination {...paginationProps} testId="pagination-top" />}
            {view === "table" ? (
              <ItemTable items={pageItems} {...actionProps} />
            ) : (
              <div data-testid="item-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {pageItems.map((item) => (
                  <ItemCard key={item.id} item={item} {...actionProps} />
                ))}
              </div>
            )}
            {visible.length > PAGE_SIZE && <Pagination {...paginationProps} />}
          </div>
        )}
        </div>
        </div>
      </main>

      {/* Footer: disclaimer, About and feedback */}
      <footer data-testid="site-footer" className="mt-6 border-t border-slate-800/80 bg-[#0B0F17]/60">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="max-w-3xl space-y-1.5">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-300">
              CardStakk · Gundam Card Game sales tracker
            </p>
            <p className="text-xs leading-relaxed text-slate-500">{DISCLAIMER}</p>
          </div>
          <nav className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Site">
            <button
              type="button"
              data-testid="footer-about"
              onClick={() => setAboutOpen(true)}
              className="font-medium text-slate-300 underline-offset-4 hover:text-sky-300 hover:underline"
            >
              About this site
            </button>
            <a
              data-testid="footer-feedback"
              href={FEEDBACK_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-300 underline-offset-4 hover:text-sky-300 hover:underline"
            >
              Send feedback
            </a>
            <span className="font-mono text-slate-600">© {new Date().getFullYear()} CardStakk</span>
          </nav>
        </div>
      </footer>

      {exportOpen && (
        <ExportDialog
          shown={visible}
          total={items.length}
          tabLabel={TABS.find((t) => t.id === tab)?.label ?? "All Items"}
          onClose={() => setExportOpen(false)}
        />
      )}

      {aboutOpen && (
        <Dialog open onOpenChange={(open) => !open && setAboutOpen(false)}>
          <DialogContent className="sm:max-w-lg" data-testid="about-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading uppercase tracking-tight">About CardStakk</DialogTitle>
              <DialogDescription>A personal tracker for Gundam Card Game cards and products.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm leading-relaxed text-slate-300">
              <p>
                CardStakk keeps track of the cards and products you own and sell: what's for sale, what's pending with a
                buyer, and what's sold — with asking prices, what you paid, and your profit after costs.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-slate-400">
                <li>Add cards and products from a database built from the official card list and product pages.</li>
                <li>List sets part by part, bundle several products together, and price each part or card.</li>
                <li>Add custom items for anything that isn't in the database.</li>
                <li>Your listings are stored in your own database, on your own computer.</li>
              </ul>
              <p className="text-xs text-slate-500">{DISCLAIMER}</p>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noreferrer"
                className="self-center text-sm text-slate-300 underline-offset-4 hover:text-sky-300 hover:underline"
              >
                Send feedback
              </a>
              <Button onClick={() => setAboutOpen(false)} data-testid="about-close">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
          bundle={bundle}
          setBundle={setBundle}
          onListBundle={listBundle}
          onAddItem={() => {
            setAddCardOpen(false);
            setAddItemOpen(true);
          }}
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
          bundle={bundle}
          setBundle={setBundle}
          onListBundle={listBundle}
          onAddCard={() => {
            setAddItemOpen(false);
            setAddCardOpen(true);
          }}
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

/* ---------------- export to Excel ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fetch the .xlsx for these listings (empty ids = every listing).
async function fetchWorkbook(ids: string[]): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/items/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Could not create the Excel file — please try again.");
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return { blob: await res.blob(), filename: match?.[1] ?? "cardstakk-listings.xlsx" };
}

// Export the listings as an editable Excel workbook: download it, share it (phones), or email it.
function ExportDialog({
  shown,
  total,
  tabLabel,
  onClose,
}: {
  shown: CollectionItem[];
  total: number;
  tabLabel: string;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"shown" | "all">("shown");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"download" | "share" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = scope === "all" ? [] : shown.map((i) => i.id);
  const count = scope === "all" ? total : shown.length;
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      const { blob, filename } = await fetchWorkbook(ids);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the Excel file.");
    } finally {
      setBusy(null);
    }
  };

  // Phones: hand the file to the share sheet (save to Files / Drive, open in Excel, send …).
  const share = async () => {
    setBusy("share");
    setError(null);
    try {
      const { blob, filename } = await fetchWorkbook(ids);
      const file = new File([blob], filename, { type: blob.type });
      if (!navigator.canShare?.({ files: [file] })) throw new Error("This device can't share files — use Download instead.");
      await navigator.share({ files: [file], title: filename });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Could not share the file.");
      }
    } finally {
      setBusy(null);
    }
  };

  const sendEmail = async () => {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      setError("Enter a valid email address, e.g. name@example.com.");
      return;
    }
    setBusy("email");
    setError(null);
    try {
      const res = await fetch("/api/items/export/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, to, note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : "Could not send the email — please try again.";
        throw new Error(detail);
      }
      toast.success(`Sent to ${to}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the email.");
    } finally {
      setBusy(null);
    }
  };

  const LBL = "font-mono text-xs uppercase tracking-wider text-slate-400";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Export to Excel</DialogTitle>
          <DialogDescription>
            An editable .xlsx spreadsheet — opens in Excel, Google Sheets, LibreOffice, Numbers and the Excel / Sheets
            phone apps.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <span className={LBL} id="export-scope-label">
              Listings
            </span>
            <div role="radiogroup" aria-labelledby="export-scope-label" className="grid grid-cols-2 gap-2">
              {(
                [
                  ["shown", `Shown now (${shown.length})`, `${tabLabel}, with your filters and sort`],
                  ["all", `Everything (${total})`, "All listings, including sold"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  data-testid={`export-scope-${value}`}
                  onClick={() => setScope(value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    scope === value
                      ? "border-sky-500 bg-sky-950/50 text-slate-100"
                      : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={download} disabled={busy !== null || count === 0} data-testid="export-download">
              {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download
              .xlsx
            </Button>
            {canShare && (
              <Button variant="outline" onClick={share} disabled={busy !== null || count === 0} data-testid="export-share">
                {busy === "share" ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} Share…
              </Button>
            )}
          </div>

          <div className="space-y-2 border-t border-slate-800/80 pt-4">
            <label htmlFor="export-email" className={LBL}>
              Send by email
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="export-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void sendEmail()}
                data-testid="export-email"
              />
              <Button
                variant="outline"
                onClick={sendEmail}
                disabled={busy !== null || count === 0}
                data-testid="export-send"
                className="shrink-0"
              >
                {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Send
              </Button>
            </div>
            <Textarea
              rows={2}
              placeholder="Message (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="export-note"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert" data-testid="export-error">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
