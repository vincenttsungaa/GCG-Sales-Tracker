import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast, Toaster } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorText } from "@/lib/api";
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
import ScanDialog from "@/components/ScanDialog";
import { Menu } from "@base-ui/react/menu";
import type { User } from "@/pages/Landing";
import { NO_STACK, StackDialog, StackFolder, StackSales, StacksPanel } from "@/components/Stacks";
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
  FolderInput,
  Download,
  Mail,
  Share2,
  Loader2,
  CheckSquare,
  Layers,
  Package,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Table2,
  LayoutGrid,
  Undo2,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lock,
  Trash2,
  X,
  PackagePlus,
  CopyPlus,
  LogOut,
  ChartColumn,
  Library,
  Settings,
} from "lucide-react";
import { formatAud } from "@/lib/format";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { avatarUrl, initialsOf } from "@/lib/avatars";
import { isBundle, saleProfit, saleTotal, type BundleEntry, type CatalogCard, type CatalogProduct, type CollectionItem, type Stack, type ItemPayload, type StatusPayload, type TabId } from "@/lib/types";

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

// Sort: newest / oldest first, or one category of item first (then newest).
type SortId = "custom" | "newest" | "oldest" | "cards" | "starter deck" | "accessories" | "premium bandai" | "other";
const SORT_OPTIONS: { value: SortId; label: string }[] = [
  { value: "custom", label: "Custom" },
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
// "Custom": the order dragged into; listings never arranged (e.g. just added) come first, newest first.
const created = (item: CollectionItem) => Date.parse(item.created_at) || 0;
const byMyOrder = (a: CollectionItem, b: CollectionItem) =>
  a.position == null
    ? b.position == null ? created(b) - created(a) : -1
    : b.position == null ? 1 : a.position - b.position;
// "Cards": cards; "Others": items in the Other category (or none); the rest: items in that category.
const inSortGroup = (item: CollectionItem, sort: SortId) =>
  sort === "cards"
    ? item.kind === "card"
    : item.kind === "item" && (sort === "other" ? item.category === "other" || !item.category : item.category === sort);

const MENU_ITEM =
  "flex cursor-default items-center gap-2.5 rounded px-2 py-2 text-sm outline-none select-none data-[highlighted]:bg-slate-800";

export default function Dashboard({
  user,
  onSignedOut,
  notice,
}: {
  user: User;
  onSignedOut: () => void;
  notice?: string | null;
}) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (notice) toast.success(notice);
  }, [notice]);
  const [resent, setResent] = useState(false);
  const logOut = async () => {
    try {
      await apiPost("/auth/logout");
    } finally {
      onSignedOut();
    }
  };
  // the account menu's button: your profile picture, else the initials of your name (or email)
  const initials = initialsOf(user);
  const avatar = avatarUrl(user.avatar);
  const face = avatar ? <img src={avatar} alt="" className="size-full rounded-full object-cover" /> : initials;
  const resendVerification = () =>
    apiPost("/auth/resend-verification")
      .then(() => setResent(true))
      .catch((e) => toast.error(errorText(e, "Couldn't send the email — try again later.")));
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
  const [scanOpen, setScanOpen] = useState(false);
  // Stacks: named groups of For Sale / Pending listings; null = all, NO_STACK = not in a stack
  const [stackFilter, setStackFilter] = useState<string | null>(null);
  const [stackSet, setStackSet] = useState<string[] | null>(null); // Combine → "Show their listings": several Stakks at once
  // the Stacks list opens in a window from a button instead of filling the sidebar
  const [stacksOpen, setStacksOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState<string | null>(null); // Storage: the stack folder shown open
  const [folderQuery, setFolderQuery] = useState(""); // search inside the open folder (name, card number, set)
  const [stackDialog, setStackDialog] = useState<CollectionItem[] | null>(null); // listings being moved
  // what Scan found, opened in Add Card / Add Item with it already picked
  const [scannedCard, setScannedCard] = useState<CatalogCard | null>(null);
  const [scannedProduct, setScannedProduct] = useState<CatalogProduct | null>(null);
  // forget it once that dialog closes (saved, cancelled or switched), so the next Add starts empty
  useEffect(() => {
    if (!addCardOpen) setScannedCard(null);
  }, [addCardOpen]);
  useEffect(() => {
    if (!addItemOpen) setScannedProduct(null);
  }, [addItemOpen]);
  // A bundle being built in Add Item / Add Card (products and cards), listed as one item.
  const [bundle, setBundle] = useState<BundleEntry[]>([]);
  // Edit → "Add cards / items": the listing that the bundle being built will be saved back into
  const [bundleTarget, setBundleTarget] = useState<CollectionItem | null>(null);
  const listBundle = (payload: ItemPayload) => {
    if (!bundleTarget) {
      create(payload, { onSuccess: () => setBundle([]) });
      return;
    }
    const t = bundleTarget;
    updateMut.mutate(
      {
        id: t.id,
        payload: {
          ...payload,
          // a listing renamed by hand keeps its name; generated bundle names follow the contents
          name: (t.bundle_items ?? []).length > 1 && !t.name.startsWith("Bundle:") ? t.name : payload.name,
          // it's a bundle now: clear what belonged to a single card / product
          card_id: null,
          card_no: null,
          edition: null,
          part: null,
          resource_cards: [],
          alt_art_cards: [],
          sleeve_designs: [],
          card_quantities: {},
          card_prices: {},
          part_prices: {},
          condition: t.condition,
          notes: t.notes,
          expected_status: t.status,
          expected_quantity: t.quantity,
        },
      },
      {
        onSuccess: () => {
          setBundle([]);
          setBundleTarget(null);
          setAddCardOpen(false);
          setAddItemOpen(false);
        },
      },
    );
  };
  // what's already in a listing, as bundle entries (a single card / product becomes one entry)
  const asBundleEntries = (item: CollectionItem): BundleEntry[] =>
    (item.bundle_items ?? []).length > 1
      ? (item.bundle_items ?? [])
      : [
          {
            name: item.name,
            product_id: item.product_id ?? null,
            category: item.category ?? null,
            kind: item.kind,
            code: item.card_no ?? item.set_code ?? null,
            image_url: item.image_url ?? null,
            detail: [item.part, item.edition].filter(Boolean).join(" · ") || null,
            quantity: item.quantity,
            price: item.price,
            purchase_price: item.purchase_price ?? null,
            card_quantities: item.card_quantities ?? {},
            card_prices: item.card_prices ?? {},
            parts: item.part ? item.part.split(" + ") : [],
            part_prices: item.part_prices ?? {},
          },
        ];
  const addMoreTo = (item: CollectionItem) => {
    setFormState(null);
    setBundle(asBundleEntries(item));
    setBundleTarget(item);
    setAddCardOpen(true);
  };
  // once both Add dialogs are closed (saved, listed on its own or cancelled), forget the listing
  // being added to, so the next Add Card / Add Item starts a fresh bundle
  useEffect(() => {
    if (!addCardOpen && !addItemOpen && bundleTarget) {
      setBundle([]);
      setBundleTarget(null);
    }
  }, [addCardOpen, addItemOpen, bundleTarget]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dealState, setDealState] = useState<DealState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null); // the in-app "Are you sure?" box
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
    staleTime: 60 * 60_000, // a tab left open overnight picks up the new day
    retry: 2,
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
    onError: (e) => {
      invalidate(); // the list may be out of date (changed in another tab)
      toast.error(errorText(e, "Could not add the item — please try again"));
    },
  });

  // one add at a time: a double-click on Add / List bundle used to send it twice (two listings)
  const adding = useRef(false);
  const create = (payload: ItemPayload, opts?: { onSuccess?: () => void; onError?: () => void }) => {
    if (adding.current) return;
    adding.current = true;
    createMut.mutate(payload, { ...opts, onSettled: () => (adding.current = false) });
  };

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ItemPayload }) =>
      apiPut<CollectionItem>(`/items/${id}`, payload),
    onSuccess: (item) => {
      invalidate();
      setFormState(null);
      toast.success(`${item.name} updated`);
    },
    onError: (e) => {
      invalidate(); // the list may be out of date (changed in another tab)
      toast.error(errorText(e, "Could not save changes — please try again"));
    },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StatusPayload }) =>
      apiPatch<CollectionItem>(`/items/${id}/status`, payload),
    onSuccess: () => {
      invalidate();
      setDealState(null);
    },
    onError: (e) => {
      invalidate(); // the list may be out of date (changed in another tab)
      toast.error(errorText(e, "Could not update the deal — please try again"));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (item: CollectionItem) => apiDelete<void>(`/items/${item.id}`),
    onSuccess: (_, item) => {
      invalidate();
      toast.success(`${item.name} deleted`);
    },
    onError: (e) => {
      invalidate(); // the list may be out of date (changed in another tab)
      toast.error(errorText(e, "Could not delete the item — please try again"));
    },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (chosen: CollectionItem[]) => apiPost<{ deleted: number }>("/items/bulk-delete", { ids: chosen.map((i) => i.id) }),
    onSuccess: ({ deleted }, chosen) => {
      invalidate();
      setSelectedIds(new Set());
      setSelecting(false);
      // one: its name; a few: their names; many: the count
      toast.success(
        deleted === chosen.length && deleted <= 3
          ? `${chosen.map((i) => i.name).join(", ")} deleted`
          : `${deleted} ${deleted === 1 ? "listing" : "listings"} deleted`,
      );
    },
    onError: (e) => {
      invalidate(); // the list may be out of date (changed in another tab)
      toast.error(errorText(e, "Could not delete the selected listings — please try again"));
    },
  });

  const items = itemsQuery.data ?? [];
  // plan limit: listings that aren't sold (the server checks too)
  // copies split off a listing (1 of 2 to Pending / Storage) count as that listing, like on the server
  const activeListings = new Set(items.filter((i) => i.status !== "sold").map((i) => i.split_from || i.id)).size;
  const withinLimit = () => {
    if (user.listing_limit == null || activeListings < user.listing_limit) return true;
    toast.error(`You've reached the ${user.listing_limit}-listing limit on the ${user.plan} plan.`, {
      description: "Your listings are safe — upgrade to add more.",
      action: { label: "Support", onClick: () => window.location.assign("/support") },
    });
    return false;
  };
  // 80% or more of the limit used: the chip turns amber
  const nearLimit = user.listing_limit != null && activeListings >= user.listing_limit * 0.8;

  // the filters and the picked Stakk (everything but the tab)
  const passes = (item: CollectionItem) => {
    const q = filters.search.trim().toLowerCase();
    const buyer = filters.buyer.trim().toLowerCase();
    if (stackFilter === NO_STACK ? !!item.stack_id : stackFilter !== null && item.stack_id !== stackFilter) return false;
    if (stackSet && !stackSet.includes(item.stack_id ?? "")) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    if (filters.color !== "all" && item.color !== filters.color) return false;
    if (filters.cardType !== "all" && item.card_type !== filters.cardType) return false;
    if (filters.rarity !== "all" && item.rarity !== filters.rarity) return false;
    if (buyer && !(item.buyer_name ?? "").toLowerCase().includes(buyer)) return false;
    if (filters.dateFrom && (!item.deal_date || item.deal_date < filters.dateFrom)) return false;
    if (filters.dateTo && (!item.deal_date || item.deal_date > filters.dateTo)) return false;
    return true;
  };
  const inTab = (item: CollectionItem, t: TabId) =>
    t === "archive" ? item.status === "sold" : t === "all" ? item.status === "for_sale" || item.status === "pending" : item.status === t;

  const tabCounts = useMemo(() => {
    const counts: Record<TabId, number> = { all: 0, for_sale: 0, pending: 0, on_hold: 0, archive: 0 };
    for (const item of items) {
      if (item.status === "for_sale" || item.status === "pending") counts.all += 1; // Storage has its own tab
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
              : item.status === "for_sale" || item.status === "pending", // All Items: not sold, not in storage
    );
    const filtered = base.filter(passes);
    const time = (item: CollectionItem) => Date.parse(item.created_at) || 0;
    if (sort === "custom") return filtered.sort(byMyOrder);
    return filtered.sort((a, b) => {
      if (sort !== "newest" && sort !== "oldest") {
        const ga = inSortGroup(a, sort) ? 0 : 1;
        const gb = inSortGroup(b, sort) ? 0 : 1;
        if (ga !== gb) return ga - gb;
      }
      return sort === "oldest" ? time(a) - time(b) : time(b) - time(a);
    });
  }, [items, tab, filters, sort, stackFilter, stackSet]);

  // Grid with no stack picked (every tab, Sold too): each stack's listings fold into one folder tile, iPhone-style.
  const stacksQuery = useQuery({ queryKey: ["stacks"], queryFn: () => apiGet<Stack[]>("/stacks") });
  const stacks = stacksQuery.data ?? [];
  const stackById = useMemo(() => new Map(stacks.map((s) => [s.id, s.name])), [stacks]);
  const folderMode = view === "grid" && stackFilter === null && !stackSet;
  const entries = useMemo(() => {
    if (!folderMode) return visible;
        const folders = new Map<string, CollectionItem[]>();
    const out: (CollectionItem | { folder: string; items: CollectionItem[] })[] = [];
    for (const item of visible) {
      const id = item.stack_id && stackById.has(item.stack_id) ? item.stack_id : null;
      if (!id) {
        out.push(item);
        continue;
      }
      let f = folders.get(id);
      if (!f) folders.set(id, (f = [])), out.push({ folder: id, items: f }); // folder sits where its newest listing would
      f.push(item);
    }
    return out;
  }, [folderMode, visible, stackById]);
  // Nothing in this tab for the search / filters / picked Stakk: the tabs where matches are.
  // All Items already covers For Sale + Pending, so those two aren't offered separately when it's listed.
  const stakkElsewhere = useMemo(() => {
    if (stackFilter === null && !stackSet && !filtersActive(filters)) return [];
    const mine = items.filter(passes);
    const found = TABS.filter((t) => t.id !== tab)
      .map((t) => ({ ...t, n: mine.filter((i) => inTab(i, t.id)).length }))
      .filter((t) => t.n > 0);
    const hasAll = found.some((t) => t.id === "all");
    return found.filter((t) => !(hasAll && (t.id === "for_sale" || t.id === "pending")));
  }, [stackFilter, stackSet, filters, items, stackById, tab]);
  const folderItems = folderMode && openFolder ? visible.filter((i) => i.stack_id === openFolder) : [];
  const fq = folderQuery.trim().toLowerCase();
  const folderShown = fq
    ? folderItems.filter((i) => [i.name, i.card_no, i.set_code].some((v) => v?.toLowerCase().includes(fq)))
    : folderItems;
  useEffect(() => setFolderQuery(""), [openFolder]); // each folder opens with an empty search
  const folderSold = openFolder ? items.filter((i) => i.status === "sold" && i.stack_id === openFolder) : [];
  // the open Stakk's money, across every tab (Collector and up): asking value of what's not sold, sales, profit
  const stakkMoney = openFolder
    ? {
        value: items.filter((i) => i.stack_id === openFolder && i.status !== "sold").reduce((s, i) => s + i.price * i.quantity, 0),
        sold: folderSold.reduce((s, i) => s + saleTotal(i), 0),
        profit: folderSold.reduce((s, i) => s + (saleProfit(i) ?? 0), 0),
      }
    : null;
  // a folder that emptied (all moved, sold or unstacked) closes for good, so it can't pop open again later
  useEffect(() => {
    if (openFolder && folderItems.length === 0) setOpenFolder(null);
  }, [openFolder, folderItems.length]);

  // Pagination — 10 per page. Back to page 1 whenever the tab or filters change (not when a drag
  // switched the sort to "Custom": you stay where you dropped).
  const keepPage = useRef(false);
  useEffect(() => {
    if (keepPage.current) {
      keepPage.current = false;
      return;
    }
    setPage(1);
  }, [tab, filters, sort, stackFilter, stackSet]);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount); // e.g. after deleting the last item on the last page
  useEffect(() => {
    if (page > pageCount) setPage(pageCount); // step back for real, so a later add doesn't jump forward
  }, [page, pageCount]);
  const pageEntries = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageItems = pageEntries.flatMap((e) => ("folder" in e ? e.items : [e]));
  // "Select all" only takes listings you can see: never the ones tucked inside a closed stack folder,
  // or a bulk Move / Delete would also hit cards you never ticked.
  const pageLoose = pageEntries.filter((e): e is CollectionItem => !("folder" in e));
  const visibleLoose = folderMode ? entries.filter((e): e is CollectionItem => !("folder" in e)) : visible;
  // shared by the page controls above and below the list
  const paginationProps = {
    page: currentPage,
    pageCount,
    pageSize: PAGE_SIZE,
    total: entries.length,
    listings: visible.length,
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
    // straight after the new page is in place, before it's shown — an instant jump to the top of the
    // list (tabs and toolbar), just under the top bar; never down, only back up
    const el = pinSentinel.current;
    const header = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
    const top = el ? el.getBoundingClientRect().top + window.scrollY - header - 8 : 0;
    if (window.scrollY > top) window.scrollTo({ top, left: 0, behavior: "instant" });
  }, [currentPage]);

  // Switching tab: Pending / Sold add the buyer and date filters above the tabs on phones and
  // tablets, which pushed the tabs down mid-tap. Keep the tabs where they were on screen.
  const tabsTopBefore = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = tabsTopBefore.current;
    tabsTopBefore.current = null;
    const el = pinSentinel.current;
    if (before == null || !el) return;
    const moved = el.getBoundingClientRect().top - before;
    if (moved) window.scrollBy({ top: moved, left: 0, behavior: "instant" });
  }, [tab]);

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
    const more = chosen.length > 8 ? `\n…and ${chosen.length - 8} more` : "";
    const what = `${chosen.length} ${chosen.length === 1 ? "listing" : "listings"}`;
    setConfirmState({
      title: `Delete ${what}?`,
      body: "This can't be undone.",
      list: [...chosen.slice(0, 8).map((i) => i.name), ...(more ? [`…and ${chosen.length - 8} more`] : [])],
      action: "Delete",
      danger: true,
      onConfirm: () => bulkDeleteMut.mutate(chosen),
    });
  };

  const unmark = (item: CollectionItem) =>
    statusMut.mutate(
      { id: item.id, payload: { status: "for_sale" } },
      { onSuccess: () => toast.success(`${item.name} is back in your inventory`) },
    );

  // several units: ask how many go to storage (the rest stay listed); one unit or a bundle: all of it
  const hold = (item: CollectionItem) =>
    item.quantity > 1 && !isBundle(item)
      ? setDealState({ item, target: "on_hold" })
      : statusMut.mutate(
          { id: item.id, payload: { status: "on_hold" } },
          { onSuccess: () => toast.success(`${item.name} moved to storage`) },
        );

  const deleteItem = (item: CollectionItem) => {
    setConfirmState({
      title: "Delete this listing?",
      body: "This can't be undone.",
      list: [item.name],
      action: "Delete",
      danger: true,
      onConfirm: () => deleteMut.mutate(item),
    });
  };

  // ---- stacks --------------------------------------------------------------------------
  // per stack: all its listings (For Sale, Pending, Storage), and how many are For Sale / in Storage
  const stackCounts = useMemo(() => {
    const total: Record<string, number> = {};
    const forSale: Record<string, number> = {};
    const stored: Record<string, number> = {};
    for (const item of items) {
      if (item.status === "sold") continue;
      const key = item.stack_id && stackById.has(item.stack_id) ? item.stack_id : NO_STACK;
      total[key] = (total[key] ?? 0) + 1;
      if (item.status === "for_sale") forSale[key] = (forSale[key] ?? 0) + 1;
      if (item.status === "on_hold") stored[key] = (stored[key] ?? 0) + 1;
    }
    return { total, forSale, stored };
  }, [items, stackById]);
  const refreshStacks = () => {
    queryClient.invalidateQueries({ queryKey: ["stacks"] });
    invalidate();
  };
  const createStackMut = useMutation({
    mutationFn: (name: string) => apiPost<Stack>("/stacks", { name }),
    onSuccess: (s) => {
      refreshStacks();
      toast.success(`Stack “${s.name}” added`);
    },
    onError: (e) => toast.error(errorText(e, "Could not add the Stakk — please try again")),
  });
  const renameStackMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch<Stack>(`/stacks/${id}`, { name }),
    onSuccess: refreshStacks,
    onError: (e) => toast.error(errorText(e, "Could not rename the Stakk — please try again")),
  });
  const deleteStackMut = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/stacks/${id}`),
    onSuccess: (_, id) => {
      if (stackFilter === id) setStackFilter(null);
      refreshStacks();
    },
    onError: (e) => toast.error(errorText(e, "Could not delete the Stakk — please try again")),
  });
  const reorderStacksMut = useMutation({
    mutationFn: (ids: string[]) => apiPost<Stack[]>("/stacks/order", { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["stacks"] }); // a refetch in flight would undo the new order
      // show the new order right away
      const byId = new Map(stacks.map((s) => [s.id, s]));
      queryClient.setQueryData(["stacks"], ids.map((id) => byId.get(id)).filter(Boolean));
    },
    onSuccess: (saved) => queryClient.setQueryData(["stacks"], saved),
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ["stacks"] });
      toast.error(errorText(e, "Could not save the order — please try again"));
    },
  });
  // ---- Drag and drop in the grid: each card / stack folder has a grip handle (like the stacks sidebar).
  // Drag it onto another card or folder to move it there; the arrangement is saved as "Custom".
  type Drag = { ids: string[]; folder?: string };
  type DropTarget = { id: string } | { folder: string; items: CollectionItem[] };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const reorderItemsMut = useMutation({
    mutationFn: (ids: string[]) => apiPost<{ moved: number }>("/items/order", { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["items"] }); // a refetch in flight would snap the order back
      const pos = new Map(ids.map((id, i) => [id, i]));
      queryClient.setQueryData<CollectionItem[]>(["items"], (cur) => cur?.map((i) => ({ ...i, position: pos.get(i.id) ?? i.position })));
    },
    onError: (e) => {
      invalidate();
      toast.error(errorText(e, "Could not save the order — please try again"));
    },
    onSettled: invalidate,
  });
  const reorderTo = (ids: string[], targetIds: string[]) => {
    // Start from what's on screen when another sort is showing, so the drop lands where it looked.
    const shown = new Set(visible.map((i) => i.id));
    const order =
      sort === "custom"
        ? [...items].sort(byMyOrder).map((i) => i.id)
        : [...visible.map((i) => i.id), ...[...items].sort(byMyOrder).map((i) => i.id).filter((id) => !shown.has(id))];
    const down = order.indexOf(ids[0]) < order.indexOf(targetIds[0]);
    const rest = order.filter((id) => !ids.includes(id));
    // A folder sits where its first listing is, so that's the spot to land next to (its other listings
    // may be spread further down the order).
    const anchor = targetIds[0];
    rest.splice(rest.indexOf(anchor) + (down ? 1 : 0), 0, ...ids); // moving down lands after the target, up before it
    if (sort !== "custom") {
      keepPage.current = true;
      setSort("custom"); // the grid now shows the saved order
    }
    reorderItemsMut.mutate(rest);
  };
  const dropOn = (target: DropTarget) => {
    const d = drag;
    setDrag(null);
    setOver(null);
    if (!d) return;
    const targetIds = "folder" in target ? target.items.map((i) => i.id) : [target.id];
    if (targetIds.some((id) => d.ids.includes(id))) return; // dropped on itself
    reorderTo(d.ids, targetIds);
  };
  // the tile accepts drops; only its grip starts a drag, so cards can't be moved by accident
  const dropProps = (target: DropTarget, key: string) =>
    view === "grid"
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!drag) return;
            e.preventDefault();
            if (over !== key) setOver(key);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (over === key && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            dropOn(target);
          },
        }
      : {};
  // Touch screens can't drag: the grip becomes two arrow buttons that move the tile one place.
  const touch = useMediaQuery("(pointer: coarse)");
  const [arranging, setArranging] = useState(false); // phones: the move arrows show only while this is on
  // phones: Rearrange sits first in the toolbar, left of the sort button
  const arrangeButton =
    view === "grid" && touch ? (
      <Button size="sm" variant={arranging ? "secondary" : "outline"} className="shrink-0" aria-pressed={arranging} onClick={() => setArranging(!arranging)} data-testid="arrange-toggle">
        {arranging ? "Done" : "Rearrange"}
      </Button>
    ) : null;
  // the pinned toolbar gets its background and a fade underneath only once it's stuck (you've scrolled)
  const pinSentinel = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const el = pinSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPinned(!e.isIntersecting), { rootMargin: "-62px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const entryIds = (e: (typeof pageEntries)[number]) => ("folder" in e ? e.items.map((i) => i.id) : [e.id]);
  // index on this page → place in the whole list, so the first / last tile can move onto the next page
  // said aloud by screen readers after a keyboard / arrow move (the focus stays on the moved card)
  const [moveNote, setMoveNote] = useState("");
  const nudge = (index: number, dir: -1 | 1) => {
    const at = (currentPage - 1) * PAGE_SIZE + index;
    const target = entries[at + dir];
    if (!target) return;
    reorderTo(entryIds(entries[at]), entryIds(target));
    setMoveNote(`Moved to position ${at + dir + 1} of ${entries.length}.`);
  };
  const canNudge = (index: number, dir: -1 | 1) => !!entries[(currentPage - 1) * PAGE_SIZE + index + dir];
  const grip = (start: Drag, label: string, index: number) =>
    view === "grid" &&
    (touch ? (
      arranging && <span className="absolute top-1/2 left-0 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded border border-slate-700 bg-slate-900">
        {(
          [
            [-1, ChevronLeft, "earlier"],
            [1, ChevronRight, "later"],
          ] as const
        ).map(([dir, Icon, word]) => (
          <button
            key={dir}
            type="button"
            disabled={!canNudge(index, dir) || reorderItemsMut.isPending}
            onClick={() => nudge(index, dir)}
            aria-label={`Move ${label} ${word}`}
            data-testid={`move-${dir < 0 ? "earlier" : "later"}`}
            className="flex h-7 w-6 items-center justify-center text-slate-400 disabled:opacity-30"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </span>
    ) : (
      <span
        draggable
        onDragStart={(e) => {
          if (reorderItemsMut.isPending) {
            e.preventDefault(); // wait for the last move to save, or the two orders can mix
            return;
          }
          setDrag(start);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", label); // Firefox only starts a drag that carries data
          const tile = e.currentTarget.parentElement; // drag the whole card's picture, not just the handle
          if (tile) e.dataTransfer.setDragImage(tile, 24, 24);
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        title="Drag to move (or focus and use the arrow keys)"
        aria-label={`Move ${label}: drag, or use the arrow keys`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
          if (!dir) return;
          e.preventDefault();
          if (!reorderItemsMut.isPending && canNudge(index, dir)) nudge(index, dir);
        }}
        data-testid="drag-handle"
        className="absolute top-1/2 left-0 z-10 flex h-10 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded border border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500 hover:text-slate-200 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <GripVertical className="size-3.5" />
      </span>
    ));
  const dropRing = (key: string, ids: string[]) =>
    over === key && drag && !ids.some((id) => drag.ids.includes(id)) ? "ring-2 ring-sky-400" : "";
  const dragging = (ids: string[]) => !!drag && ids.every((id) => drag.ids.includes(id));
  const moveMut = useMutation({
    mutationFn: ({ ids, stackId }: { ids: string[]; stackId: string | null }) =>
      apiPost<CollectionItem[]>("/stacks/assign", { ids, stack_id: stackId }),
    onSuccess: (_, { ids, stackId }) => {
      invalidate();
      setStackDialog(null);
      if (ids.some((id) => selectedIds.has(id))) stopSelecting(); // moved from the selection bar: done selecting
      const what = ids.length === 1 ? "1 listing" : `${ids.length} listings`;
      toast.success(stackId ? `${what} moved to “${stackById.get(stackId) ?? "the Stakk"}”` : `${what} taken out of its Stakk`);
    },
    onError: (e) => toast.error(errorText(e, "Could not move to the Stakk — please try again")),
  });
  const moveToStack = (stackId: string | null) =>
    stackDialog && moveMut.mutate({ ids: stackDialog.map((i) => i.id), stackId });
  const createAndMove = (name: string) =>
    createStackMut.mutate(name, { onSuccess: (s) => moveToStack(s.id) });
  const stackStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "on_hold" | "for_sale" }) =>
      apiPost<{ moved: number }>(`/stacks/${id}/status`, { status }),
    onSuccess: ({ moved }, { status }) => {
      invalidate();
      toast.success(`${moved} ${moved === 1 ? "listing" : "listings"} ${status === "on_hold" ? "moved to storage" : "back for sale"}`);
    },
    onError: (e) => {
      invalidate();
      toast.error(errorText(e, "Could not move the Stakk — please try again"));
    },
  });
  const storeStack = (s: Stack) => {
    const pending = items.filter((i) => i.stack_id === s.id && i.status === "pending").length;
    const n = stackCounts.forSale[s.id] ?? 0;
    setConfirmState({
      title: `Move “${s.name}” to Storage?`,
      body: `${n} For Sale listing${n === 1 ? "" : "s"} will move to storage.${pending ? ` ${pending} pending (with a buyer) stay as they are.` : ""}`,
      action: "Move to Storage",
      onConfirm: () => stackStatusMut.mutate({ id: s.id, status: "on_hold" }),
    });
  };
  const deleteStack = (s: Stack) => {
    const n = items.filter((i) => i.stack_id === s.id).length;
    setConfirmState({
      title: `Delete the Stakk “${s.name}”?`,
      body: n ? `Its ${n} listing${n === 1 ? "" : "s"} stay, just out of any stack.` : "It's empty.",
      action: "Delete Stakk",
      danger: true,
      onConfirm: () => deleteStackMut.mutate(s.id),
    });
  };

  const actionProps = {
    onStack: (item: CollectionItem) => setStackDialog([item]),
    onUnstack: (item: CollectionItem) => moveMut.mutate({ ids: [item.id], stackId: null }),
    stackName: (item: CollectionItem) =>
      item.stack_id && item.status !== "sold" ? (stackById.get(item.stack_id) ?? null) : null,
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
    <div data-testid="dashboard" className="flex min-h-svh flex-col bg-[#0B0F17] text-slate-200">
      <p className="sr-only" aria-live="polite">
        {moveNote}
      </p>
      {/* HUD top bar: the name on an angled plate with an amber edge (like a cockpit display), and Scan / Add Item / Add Card joined into one control. Styles in index.css. */}
      <header className="sticky top-0 z-40">
        <div className="mx-auto flex min-h-[60px] max-w-[1600px] items-stretch gap-1 pr-3 sm:gap-4 sm:pr-6">
          <div className="hud-plate flex shrink-0 items-center gap-2 pr-6 pl-3 sm:gap-2.5 sm:pr-10 sm:pl-6" data-testid="hud-plate">
            {/* app icon (same as the browser tab icon): two fanned cards with a star */}
            <img src="/favicon.svg" alt="" aria-hidden className="size-7 shrink-0 max-sm:hidden sm:size-8" data-testid="app-logo" />
            <div>
              {/* never cut short: the plate keeps its width and the buttons tighten on phones instead */}
              <h1 className="font-heading text-base font-bold whitespace-nowrap sm:text-lg">CardStakk</h1>
              {/* tagline: says what it's for; the name stays CardStakk */}
              <p className="whitespace-nowrap" data-testid="app-tagline">GCG Sales Tracker</p>
            </div>
          </div>
          <span className="flex-1" />
          <div className="hud-seg flex shrink-0 self-center" role="group" aria-label="Scan or add">
            {/* Scan is on hold: hidden for now (it also made the header too wide for phones) */}
            <Button variant="outline" aria-label="Scan" data-testid="scan-button" className="hidden" onClick={() => setScanOpen(true)}>
              <ScanLine className="size-4" /> <span className="hidden sm:inline">Scan</span>
            </Button>
            <Button
              variant="outline"
              aria-label="Add Item"
              data-testid="add-item-button"
              onClick={() => withinLimit() && setAddItemOpen(true)}
            >
              {/* phones: the icon only, so the plan badge and Log out still fit */}
              <PackagePlus className="size-4" /> <span className="hidden sm:inline">Add Item</span>
            </Button>
            <Button
              aria-label="Add Card"
              data-testid="add-card-button"
              onClick={() => withinLimit() && setAddCardOpen(true)}
            >
              <CopyPlus className="size-4" /> <span className="hidden sm:inline">Add Card</span>
            </Button>
          </div>
          {/* your plan and how many listings it allows (phones: count only) */}
          <a
            href="/support"
            data-testid="plan-chip"
            data-tier={user.tier} // text colour: Free white, Collector blue, Dealer purple, Founding gold (index.css)
            data-founding={user.founding ? "true" : undefined}
            title={
              nearLimit
                ? `You're close to the ${user.listing_limit}-listing limit on the ${user.plan} plan — see Support`
                : `${user.plan} plan — see what each plan includes`
            }
            // the plan badge: dark angled plate, text in the plan's colour; the same in every theme
            className="shrink-0 self-center bg-[linear-gradient(135deg,#1f2630,#3a4556)] px-2 py-1.5 sm:px-3 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap text-[#f3d38a] uppercase hover:brightness-125 [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]"
          >
            <span className="max-sm:hidden">
              {user.tier > 0 && "★ "}
              {user.plan} ·{" "}
            </span>
            {/* 80% or more of the limit used: the count turns orange */}
            <span className={nearLimit ? "font-bold text-[#ffa94d]" : "text-[#d5dbe3]"}>
              {nearLimit && "! "}
              {activeListings}/{user.listing_limit ?? "∞"}
            </span>
          </a>
          {/* account menu: your initials → Statistics, Export, Account settings, Log out */}
          <Menu.Root>
            <Menu.Trigger
              aria-label={`Account menu for ${user.email}`}
              title={user.email}
              data-testid="account-menu"
              className="grid size-9 shrink-0 place-items-center self-center overflow-hidden rounded-full bg-[#4a6a94] text-xs font-extrabold text-white ring-2 ring-[var(--rt-line)] ring-offset-2 ring-offset-[var(--rt-panel-2)] hover:brightness-110 data-[popup-open]:ring-[#4a6a94]"
            >
              {face}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="z-50 outline-none" align="end" sideOffset={8}>
                <Menu.Popup className="w-64 rounded-lg border border-slate-700 bg-[#1a2130] p-1 text-slate-200 shadow-lg outline-none" data-testid="account-menu-popup">
                  <div className="flex items-center gap-3 border-b border-slate-700 px-2 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#4a6a94] text-xs font-extrabold text-white" aria-hidden>
                      {face}
                    </span>
                    <span className="min-w-0">
                      <b className="block truncate text-sm">{user.name || user.email}</b>
                      {user.created_at && (
                        <span className="block text-xs text-slate-400" data-testid="menu-joined">
                          Joined {new Date(user.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="py-1">
                    {/* personal collection: not built yet */}
                    <Menu.Item disabled className={`${MENU_ITEM} opacity-50`} data-testid="menu-collection">
                      <Library className="size-4" /> Collection <i className="ml-auto text-xs text-slate-400">coming soon</i>
                    </Menu.Item>
                    <Menu.Item className={MENU_ITEM} onClick={() => window.location.assign("/stats")} data-testid="menu-stats">
                      <ChartColumn className="size-4" /> Statistics
                    </Menu.Item>
                    <Menu.Item className={MENU_ITEM} onClick={() => setExportOpen(true)} data-testid="menu-export">
                      <FileSpreadsheet className="size-4" /> Export to Excel
                    </Menu.Item>
                  </div>
                  <div className="border-t border-slate-700 py-1">
                    <Menu.Item className={MENU_ITEM} onClick={() => window.location.assign("/account")} data-testid="menu-account">
                      <Settings className="size-4" /> Account settings
                    </Menu.Item>
                  </div>
                  <div className="border-t border-slate-700 pt-1">
                    <Menu.Item className={`${MENU_ITEM} text-red-400`} onClick={logOut} data-testid="header-log-out">
                      <LogOut className="size-4" /> Log out
                    </Menu.Item>
                  </div>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </header>
      {/* email accounts: a reminder until the address is confirmed */}
      {!user.email_verified && (
        <p data-testid="verify-banner" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-xs text-slate-200 sm:px-6">
          Confirm your email: we sent a link to <span className="font-semibold">{user.email}</span>.{" "}
          {resent ? (
            "Sent again — check your inbox."
          ) : (
            <button type="button" className="font-semibold underline underline-offset-2" onClick={resendVerification}>
              Send it again
            </button>
          )}
        </p>
      )}

      {/* Wide screens: stats and filters in a sidebar on the left, the listings on the right.
          Narrower screens: one column (stats, filters + Stacks, toolbar + tabs, listings) — the sidebar and the
          right column use display:contents there, and `order` keeps that sequence. */}
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:gap-6">
        {/* Sidebar stays put while the listings scroll: it sticks at exactly where it starts
            (header 61px + the page's 24px top padding), so it doesn't shift on scroll. */}
        <aside
          data-testid="sidebar"
          className="contents lg:sticky lg:top-[85px] lg:flex lg:max-h-[calc(100svh-101px)] lg:w-72 lg:shrink-0 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:[scrollbar-width:thin]"
        >
          <div className="order-1 lg:order-none">
            <StatsStrip items={items} />
            <a href="/stats" data-testid="stats-link" className="mt-2 hidden text-xs font-semibold text-[var(--rt-text)] underline underline-offset-2 lg:inline-block">
              See full stats →
            </a>
          </div>
          <div className="order-2 lg:order-none">
            <FilterBar filters={filters} onChange={setFilters} showBuyer={showBuyer} />
          </div>
          <div className="order-2 lg:order-none">
              <>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  data-testid="stacks-open"
                  onClick={() => setStacksOpen(true)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Layers className="size-4 shrink-0" />
                    <span className="truncate">
                      Stakks
                      {stackFilter && (
                        <span className="normal-case text-slate-400"> · {stackFilter === NO_STACK ? "Not in a Stakk" : (stackById.get(stackFilter) ?? "")}</span>
                      )}
                      {stackSet && <span className="normal-case text-slate-400"> · {stackSet.length} Stakks</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-slate-400">
                    {stacks.length}
                    <ChevronDown className="size-4" />
                  </span>
                </Button>
                <Dialog open={stacksOpen} onOpenChange={setStacksOpen}>
                  <DialogContent className="max-h-[85svh] overflow-y-auto" data-testid="stacks-dialog">
                    <DialogHeader>
                      <DialogTitle>Stakks</DialogTitle>
                      <DialogDescription>Tap a Stakk to show only its listings.</DialogDescription>
                    </DialogHeader>
                    <StacksPanel
                      stacks={stacks}
                      counts={stackCounts.total}
                      forSale={stackCounts.forSale}
                      stored={stackCounts.stored}
                      onStore={storeStack}
                      onUnstore={(s) => stackStatusMut.mutate({ id: s.id, status: "for_sale" })}
                      selected={stackFilter ?? (stackSet ? "several" : null)}
                      onSelect={(id) => {
                        setStackFilter(id);
                        setStackSet(null);
                        setStacksOpen(false);
                      }}
                      items={items}
                      onShowMany={(ids) => {
                        setStackSet(ids);
                        setStackFilter(null);
                        setStacksOpen(false);
                      }}
                      onCreate={(name) => createStackMut.mutate(name)}
                      onRename={(id, name) => renameStackMut.mutate({ id, name })}
                      onDelete={deleteStack}
                      onReorder={(ids) => reorderStacksMut.mutate(ids)}
                    />
                  </DialogContent>
                </Dialog>
              </>
          </div>
        </aside>

        <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-5">
        {/* Computers: the tabs, toolbar, hint, top pagination (and the Select bar) stay pinned under the top
            bar while the listings scroll. Phones / tablets: search filters and Stakks sit above this block. */}
        <div ref={pinSentinel} className="order-3 -mb-4 h-0 sm:-mb-5 lg:order-none" aria-hidden /> {/* marker: cancels the column gap */}
        <div
          className="pin-bar order-3 space-y-3 lg:sticky lg:top-[61px] lg:z-30 lg:order-none lg:-mx-2 lg:px-2 lg:py-3"
          data-pinned={pinned || undefined}
        >
        {/* tabs and toolbar: side by side when they fit, else the toolbar wraps below (never over the tabs) */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:justify-between">
          {/* Phones / small tablets: the tabs on top as five equal columns (name over count) so they fit
              without scrolling sideways, then the buttons centred below. */}
          <div className="min-w-0 basis-full md:flex-1 md:basis-auto md:overflow-x-auto md:[scrollbar-width:none]">
          <Tabs
            value={tab}
            onValueChange={(value: string) => {
              tabsTopBefore.current = pinSentinel.current?.getBoundingClientRect().top ?? null;
              setTab(value as TabId);
            }}
          >
            <TabsList className="grid w-full grid-cols-5 max-md:h-auto! md:inline-flex md:w-max">
              {TABS.map(({ id, label, testId }) => (
                <TabsTrigger key={id} value={id} data-testid={testId} className="flex-col gap-0.5 px-1 py-1 text-xs md:flex-row md:gap-2 md:px-1.5 md:py-0.5">
                  {id === "archive" && <Archive className="size-3.5 max-md:hidden" aria-hidden />}
                  {label}
                  <span
                    data-testid={`${testId}-count`}
                    className="rounded-sm bg-slate-800 px-1.5 font-mono text-[10px] tabular-nums text-slate-300"
                  >
                    {tabCounts[id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          </div>
          {/* Statistics and Export are in the account menu (your initials, top right) */}
          {arrangeButton}
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
              aria-pressed={view === "table"}
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
              aria-pressed={view === "grid"}
              title="Grid view"
              data-testid="view-grid"
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="size-4" />
            </Button>
          </div>
        </div>
        {selecting && (
          <div
            data-testid="selection-bar-pinned"
            className="hidden lg:flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800/80 bg-[#181b22] px-3 py-2"
          >
            <span className="font-mono text-xs text-slate-200" data-testid="selection-count-pinned">
              {selectedIds.size} selected
            </span>
            <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => selectAll(pageLoose)}>
              Select all on page
            </Button>
            {visibleLoose.length > pageLoose.length && (
              <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => selectAll(visibleLoose)}>
                Select all ({visibleLoose.length})
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-[length:calc(0.8rem-2px)]"
                data-testid="stack-selected-pinned"
                disabled={!visible.some((i) => selectedIds.has(i.id) && i.status !== "sold")}
                title="Sold listings stay where they are"
                onClick={() => {
                  const chosen = visible.filter((i) => selectedIds.has(i.id));
                  const unsold = chosen.filter((i) => i.status !== "sold");
                  if (unsold.length < chosen.length)
                    toast.info(`${chosen.length - unsold.length} sold ${chosen.length - unsold.length === 1 ? "listing stays" : "listings stay"} where ${chosen.length - unsold.length === 1 ? "it is" : "they are"}`);
                  setStackDialog(unsold);
                }}
              >
                <FolderInput className="size-4" /> Move to Stakk
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="text-[length:calc(0.8rem-2px)]"
                data-testid="delete-selected-pinned"
                disabled={selectedIds.size === 0 || bulkDeleteMut.isPending}
                onClick={deleteSelected}
              >
                <Trash2 className="size-4" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" className="text-[length:calc(0.8rem-2px)]" onClick={stopSelecting} aria-label="Cancel selecting">
                <X className="size-4" /> Cancel
              </Button>
            </span>
          </div>
        )}
        {!itemsQuery.isError && !itemsQuery.isLoading && visible.length > 0 && (
          <>
          {view === "grid" &&
            (touch ? (
              arranging && (
                <p className="text-xs text-slate-500" data-testid="my-order-hint">
                  Use the arrows on the left of a card or folder to move it — the order is saved (“Custom”).
                </p>
              )
            ) : (
              <p className="text-xs text-slate-500" data-testid="my-order-hint">
                Drag the grip on the left of a card or folder to rearrange them — the order is saved (“Custom”).
              </p>
            ))}
          {entries.length > PAGE_SIZE && <Pagination {...paginationProps} testId="pagination-top" />}
          </>
        )}
        </div>

        <div className="order-4 min-w-0 space-y-4 sm:space-y-5 lg:order-none">
        {/* Select mode: tick listings, then delete them together (same colour as the footer) */}
        {selecting && (
          <div
            data-testid="selection-bar"
            className="sticky top-16 z-30 flex lg:hidden flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800/80 bg-[#181b22] px-3 py-2"
          >
            <span className="font-mono text-xs text-slate-200" data-testid="selection-count">
              {selectedIds.size} selected
            </span>
            <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => selectAll(pageLoose)}>
              Select all on page
            </Button>
            {visibleLoose.length > pageLoose.length && (
              <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => selectAll(visibleLoose)}>
                Select all ({visibleLoose.length})
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button variant="link" size="xs" className="h-auto px-0 text-[10px]" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-[length:calc(0.8rem-2px)]"
                data-testid="stack-selected"
                disabled={!visible.some((i) => selectedIds.has(i.id) && i.status !== "sold")}
                title="Sold listings stay where they are"
                onClick={() => {
                  const chosen = visible.filter((i) => selectedIds.has(i.id));
                  const unsold = chosen.filter((i) => i.status !== "sold");
                  if (unsold.length < chosen.length)
                    toast.info(`${chosen.length - unsold.length} sold ${chosen.length - unsold.length === 1 ? "listing stays" : "listings stay"} where ${chosen.length - unsold.length === 1 ? "it is" : "they are"}`);
                  setStackDialog(unsold);
                }}
              >
                <FolderInput className="size-4" /> Move to Stakk
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="text-[length:calc(0.8rem-2px)]"
                data-testid="delete-selected"
                disabled={selectedIds.size === 0 || bulkDeleteMut.isPending}
                onClick={deleteSelected}
              >
                <Trash2 className="size-4" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" className="text-[length:calc(0.8rem-2px)]" onClick={stopSelecting} aria-label="Cancel selecting">
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
                  {stackSet && !filtersActive(filters) ? "Nothing from these Stakks here" : stackFilter !== null && !filtersActive(filters) ? "Nothing from this Stakk here" : "No items match your filters"}
                </p>
                {stakkElsewhere.length > 0 && (
                  <p className="mt-1 text-sm text-slate-400" data-testid="stakk-elsewhere">
                    {filtersActive(filters)
                      ? `${stakkElsewhere.map((t) => `${t.n} ${t.n === 1 ? "match" : "matches"} in ${t.label}`).join(" and ")}.`
                      : `${stackSet ? `These ${stackSet.length} Stakks have` : stackFilter === NO_STACK ? "Listings not in a Stakk has" : `“${stackById.get(stackFilter ?? "") ?? "This Stakk"}” has`} ${stakkElsewhere
                          .map((t) => `${t.n} in ${t.label}`)
                          .join(" and ")}.`}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {stakkElsewhere.map((t) => (
                    <Button key={t.id} variant="outline" onClick={() => setTab(t.id)} data-testid={`stakk-goto-${t.id}`}>
                      Show {t.label}
                    </Button>
                  ))}
                  {(stackFilter !== null || stackSet) && (
                    <Button variant="outline" onClick={() => { setStackFilter(null); setStackSet(null); }} data-testid="stakk-clear">
                      Show all Stakks
                    </Button>
                  )}
                  {filtersActive(filters) && (
                    <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                      Clear filters
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {view === "table" ? (
              <ItemTable items={pageItems} {...actionProps} />
            ) : (
              <div data-testid="item-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {pageEntries.map((e, index) =>
                  "folder" in e ? (
                    <div
                      key={e.folder}
                      {...dropProps({ folder: e.folder, items: e.items }, `f:${e.folder}`)}
                      className={`relative rounded-xl [&>article]:h-full ${dropRing(`f:${e.folder}`, e.items.map((i) => i.id))} ${dragging(e.items.map((i) => i.id)) ? "opacity-40" : ""}`}
                    >
                      {grip({ ids: e.items.map((i) => i.id), folder: e.folder }, stackById.get(e.folder) ?? "Stakk", index)}
                      <StackFolder
                        name={stackById.get(e.folder) ?? "Stakk"}
                        items={e.items}
                        // same as the Value box inside the folder: everything in it that isn't sold (every plan)
                        value={items.filter((i) => i.stack_id === e.folder && i.status !== "sold").reduce((t, i) => t + i.price * i.quantity, 0)}
                        onOpen={() => setOpenFolder(e.folder)}
                      />
                    </div>
                  ) : (
                    <div
                      key={e.id}
                      {...dropProps({ id: e.id }, e.id)}
                      className={`relative rounded-xl [&>article]:h-full ${dropRing(e.id, [e.id])} ${dragging([e.id]) ? "opacity-40" : ""}`}
                    >
                      {grip({ ids: [e.id] }, e.name, index)}
                      <ItemCard item={e} {...actionProps} />
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        )}
        {/* phones and tablets: page numbers under the list too (desktop keeps them pinned at the top) */}
        {!itemsQuery.isError && !itemsQuery.isLoading && entries.length > PAGE_SIZE && (
          <div className="lg:hidden">
            <Pagination {...paginationProps} testId="pagination-bottom" />
          </div>
        )}
        </div>
        </div>
      </main>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

      {/* An open stack folder: its listings in this tab, then what it has sold */}
      <Dialog open={folderItems.length > 0} onOpenChange={(open) => !open && setOpenFolder(null)}>
        {/* Phones: the folder opens full screen (more room for the cards), with its buttons pinned to the bottom */}
        <DialogContent
          className="max-h-[90svh] overflow-y-auto sm:max-w-4xl max-sm:top-0 max-sm:left-0 max-sm:h-[100svh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:rounded-none max-sm:p-3"
          data-testid="stack-folder-dialog"
        >
          <DialogHeader>
            <DialogTitle>{stackById.get(openFolder ?? "") ?? "Stakk"}</DialogTitle>
            <DialogDescription>
              {folderItems.length} {folderItems.length === 1 ? "listing" : "listings"}
              {tab === "on_hold" ? " in storage" : tab === "for_sale" ? " for sale" : tab === "pending" ? " pending" : tab === "archive" ? " sold" : ""}
            </DialogDescription>
          </DialogHeader>
          {stakkMoney &&
            (
              <div className="grid grid-cols-3 gap-2" data-testid="stakk-money">
                {(
                  [
                    ["Value", stakkMoney.value, "text-amber-300", "Asking total of everything in this Stakk that isn't sold (For Sale, Pending and Storage)"],
                    // sales and profit only once something from this Stakk has sold
                    ...(folderSold.length
                      ? ([
                          ["Sales", stakkMoney.sold, "text-emerald-300", "What this Stakk has sold for"],
                          ["Profit", stakkMoney.profit, stakkMoney.profit < 0 ? "text-red-400" : "text-emerald-300", "Sales minus what you paid (sales with no bought price are left out)"],
                        ] as const)
                      : []),
                  ] as const
                ).map(([t, v, c, hint]) => (
                  <div key={t} title={hint} className="rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{t}</p>
                    <p className={`truncate font-mono text-sm font-semibold tabular-nums ${c}`}>{formatAud(v)}</p>
                  </div>
                ))}
              </div>
            )}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <Input
              type="search"
              value={folderQuery}
              onChange={(e) => setFolderQuery(e.target.value)}
              placeholder={`Search this Stakk — name or card number`}
              aria-label={`Search ${stackById.get(openFolder ?? "") ?? "this Stakk"}`}
              className="h-9 pl-8"
              data-testid="folder-search"
            />
          </div>
          {fq && (
            <p className="text-xs text-slate-400" data-testid="folder-search-count">
              {folderShown.length} of {folderItems.length} {folderItems.length === 1 ? "listing" : "listings"}
            </p>
          )}
          {folderShown.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No listings in this Stakk match “{folderQuery.trim()}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {folderShown.map((item) => (
                <ItemCard key={item.id} item={item} {...actionProps} />
              ))}
            </div>
          )}
          {tab !== "archive" && <StackSales sold={folderSold} />}
          <DialogFooter className="max-sm:sticky max-sm:-bottom-3 max-sm:-mx-3 max-sm:-mb-3 max-sm:bg-[#33373c] max-sm:p-3 max-sm:empty:hidden">
            {tab === "archive" ? null : tab === "on_hold" ? (
              <Button
                variant="outline"
                data-testid="folder-unstore"
                disabled={stackStatusMut.isPending}
                onClick={() => openFolder && stackStatusMut.mutate({ id: openFolder, status: "for_sale" })}
              >
                <Undo2 className="size-4" /> All back to For Sale
              </Button>
            ) : (
              folderItems.some((i) => i.status === "for_sale") && (
                <Button
                  variant="outline"
                  data-testid="folder-store"
                  disabled={stackStatusMut.isPending}
                  onClick={() => {
                    const s = stacks.find((x) => x.id === openFolder);
                    if (s) storeStack(s);
                  }}
                >
                  <Lock className="size-4" /> Move all to Storage
                </Button>
              )
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer: disclaimer, About and feedback */}
      {/* mt-auto: on a short page the footer sits at the bottom of the screen, not mid-page */}
      <footer data-testid="site-footer" className="mt-auto border-t border-slate-800/80 bg-[#0B0F17]/60">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="max-w-3xl space-y-1.5">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-300">
              CardStakk · GCG inventory &amp; sales tracker
            </p>
            <p className="text-xs leading-relaxed text-slate-400">{DISCLAIMER}</p>
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
            <a href="/privacy" className="font-medium text-slate-300 underline-offset-4 hover:text-sky-300 hover:underline">
              Privacy
            </a>
            <a href="/terms" className="font-medium text-slate-300 underline-offset-4 hover:text-sky-300 hover:underline">
              Terms
            </a>
            <span className="font-mono text-slate-600">© {new Date().getFullYear()} CardStakk</span>
          </nav>
        </div>
      </footer>

      {exportOpen && (
        <ExportDialog
          shown={visible}
          items={items}
          stacks={stacks}
          tabLabel={TABS.find((t) => t.id === tab)?.label ?? "All Items"}
          full={user.tier >= 1}
          email={user.email}
          verified={user.email_verified}
          onClose={() => setExportOpen(false)}
        />
      )}

      {/* a name is required: asked for once, right after sign-up (or for an older account without one) */}
      {!user.name?.trim() && <NameRequiredDialog onSaved={(u) => queryClient.setQueryData(["me"], u)} />}
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
                <li>
                  Add cards and products from a database built from the official card list and product pages on{" "}
                  <a href="https://www.gundam-gcg.com/" target="_blank" rel="noreferrer" className="font-medium text-sky-300 underline underline-offset-2">
                    gundam-gcg.com
                  </a>
                  {" and "}
                  <a href="https://p-bandai.com/" target="_blank" rel="noreferrer" className="font-medium text-sky-300 underline underline-offset-2">
                    Premium Bandai
                  </a>
                  .
                </li>
                <li>List sets part by part, bundle several products together, and price each part or card.</li>
                <li>Add custom items for anything that isn't in the database.</li>
                <li>Your listings are stored in your own account; only you can see them.</li>
              </ul>
              <p className="text-xs text-slate-500">{DISCLAIMER}</p>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <a
                href="/account#feedback"
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
            id ? updateMut.mutate({ id, payload }) : create(payload)
          }
          pending={createMut.isPending || updateMut.isPending}
          onAddMore={addMoreTo}
        />
      )}

      {scanOpen && (
        <ScanDialog
          onClose={() => setScanOpen(false)}
          onPickCard={(card) => {
            setScanOpen(false);
            setScannedCard(card);
            setAddCardOpen(true);
          }}
          onPickProduct={(product) => {
            setScanOpen(false);
            setScannedProduct(product);
            setAddItemOpen(true);
          }}
        />
      )}

      {addCardOpen && (
        <AddCardDialog
          initialCard={scannedCard}
          onClose={() => {
            setAddCardOpen(false);
            setScannedCard(null);
          }}
          onSubmit={(payload) => create(payload)}
          onManual={() => {
            setAddCardOpen(false);
            setFormState({ type: "add", kind: "card" });
          }}
          pending={createMut.isPending || updateMut.isPending}
          bundle={bundle}
          setBundle={setBundle}
          onListBundle={listBundle}
          bundleSaveLabel={bundleTarget ? "Save to listing" : undefined}
          onAddItem={() => {
            setAddCardOpen(false);
            setAddItemOpen(true);
          }}
        />
      )}

      {addItemOpen && (
        <AddItemDialog
          initialProduct={scannedProduct}
          onClose={() => {
            setAddItemOpen(false);
            setScannedProduct(null);
          }}
          onSubmit={(payload, options) => {
            keepAddItemOpen.current = !!options?.keepOpen;
            create(payload, {
              onSuccess: () => options?.onDone?.(),
              onError: () => {
                keepAddItemOpen.current = false;
              },
            });
          }}
          pending={createMut.isPending || updateMut.isPending}
          bundle={bundle}
          setBundle={setBundle}
          onListBundle={listBundle}
          bundleSaveLabel={bundleTarget ? "Save to listing" : undefined}
          onAddCard={() => {
            setAddItemOpen(false);
            setAddCardOpen(true);
          }}
        />
      )}

      {stackDialog && stackDialog.length > 0 && (
        <StackDialog
          title={stackDialog.length === 1 ? stackDialog[0].name : `${stackDialog.length} listings`}
          stacks={stacks}
          current={stackDialog.length === 1 ? stackDialog[0].stack_id : undefined}
          onPick={moveToStack}
          onCreateAndPick={createAndMove}
          onClose={() => setStackDialog(null)}
          pending={moveMut.isPending || createStackMut.isPending}
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
                  else if (target === "on_hold")
                    toast.success(
                      qtySold < source.quantity
                        ? `${qtySold} of ${source.quantity} ${source.name} moved to storage`
                        : `${source.name} moved to storage`,
                    );
                  else toast.success(`${source.name} marked as pending`);
                },
              },
            );
          }}
          pending={statusMut.isPending}
        />
      )}

      {/* messages: the footer's dark grey, no border; the icon keeps its green / red / amber */}
      <Toaster
        toastOptions={{
          style: { background: "#181b22", border: "none", color: "#e2e8f0" },
          classNames: {
            success: "[&_[data-icon]]:text-emerald-400",
            error: "[&_[data-icon]]:text-red-400",
            warning: "[&_[data-icon]]:text-amber-400",
            info: "[&_[data-icon]]:text-sky-400",
          },
        }}
      />
    </div>
  );
}

/* ---------------- export to Excel ---------------- */

// The in-app "Are you sure?" box (instead of the browser's own confirm pop-up), in the footer's colours.
interface ConfirmState {
  title: string;
  body: string;
  list?: string[]; // names of what's affected
  action: string; // the confirm button's label
  danger?: boolean;
  onConfirm: () => void;
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  // keep the last text while the box fades out
  const last = useRef<ConfirmState | null>(null);
  if (state) last.current = state;
  const s = state ?? last.current;
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="!bg-[var(--confirm-bg,#181b22)] sm:max-w-md" data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{s?.title}</DialogTitle>
          <DialogDescription>{s?.body}</DialogDescription>
        </DialogHeader>
        {s?.list && s.list.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-800/80 px-3 py-2 text-sm text-slate-200">
            {s.list.map((n, i) => (
              <li key={i} className="truncate" title={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} data-testid="confirm-cancel" autoFocus>
            Cancel
          </Button>
          <Button
            variant={s?.danger ? "destructive" : "default"}
            data-testid="confirm-ok"
            onClick={() => {
              state?.onConfirm();
              onClose();
            }}
          >
            {s?.action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// Fetch the .xlsx for these listings (empty ids = every listing).
async function fetchWorkbook(body: { ids: string[]; label: string; per_stack: boolean }): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/items/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Could not create the Excel file — please try again.");
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return { blob: await res.blob(), filename: match?.[1] ?? "cardstakk-listings.xlsx" };
}

// Same name the server gives the file: cardstakk-<what's in it>-<date>.xlsx
const exportName = (label: string) => {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "listings";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `cardstakk-${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
};

type ExportScope = "shown" | "all" | "stack" | "sold";

// Export the listings as an editable Excel workbook: 1) what to include, 2) download, share (phones) or email it.
function ExportDialog({
  shown,
  items,
  stacks,
  tabLabel,
  full,
  email,
  verified,
  onClose,
}: {
  shown: CollectionItem[];
  items: CollectionItem[];
  stacks: Stack[];
  tabLabel: string;
  full: boolean; // Collector and up: the full workbook, a sheet per Stakk, send by email (Free: one Listings sheet)
  email: string; // "Email" sends the file to the account's own email
  verified: boolean; // …once that email is confirmed
  onClose: () => void;
}) {
  const [scope, setScope] = useState<ExportScope>("shown");
  const [stackId, setStackId] = useState(stacks[0]?.id ?? "");
  const [perStack, setPerStack] = useState(false);
  const [via, setVia] = useState<"download" | "share" | "email">("download");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Share is for phones and tablets: desktop browsers often list the API but refuse spreadsheet files.
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.canShare === "function" && window.matchMedia("(pointer: coarse)").matches;
  const stackName = stacks.find((s) => s.id === stackId)?.name ?? "Stakk";

  const chosen =
    scope === "shown" ? shown : scope === "all" ? items : scope === "stack" ? items.filter((i) => i.stack_id === stackId) : items.filter((i) => i.status === "sold");
  const label = scope === "shown" ? `${tabLabel}, with your filters` : scope === "all" ? "Everything" : scope === "stack" ? stackName : "Sales";
  const body = { ids: scope === "all" ? [] : chosen.map((i) => i.id), label, per_stack: full && perStack };
  const count = chosen.length;
  const asking = chosen.filter((i) => i.status !== "sold").reduce((sum, i) => sum + i.price * i.quantity, 0);
  const realized = chosen.filter((i) => i.status === "sold").reduce((sum, i) => sum + saleTotal(i), 0);

  const run = async (fn: () => Promise<void>) => {
    if (busy || count === 0) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };
  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const download = () =>
    run(async () => {
      const { blob, filename } = await fetchWorkbook(body);
      save(blob, filename);
      toast.success(`Downloaded ${filename}`);
    });
  // Phones: hand the file to the share sheet (save to Files / Drive, open in Excel, send …).
  // iPhone only shares straight from a tap: when making the file took too long, the file is kept
  // and the next tap on Share hands it over at once.
  const [ready, setReady] = useState<{ key: string; file: File } | null>(null);
  const shareKey = JSON.stringify(body);
  const share = () =>
    run(async () => {
      let file = ready?.key === shareKey ? ready.file : null;
      const retry = !!file;
      if (!file) {
        const { blob, filename } = await fetchWorkbook(body);
        file = new File([blob], filename, { type: blob.type });
        setReady({ key: shareKey, file });
      }
      // the device can't share this file, or refused again on the second tap: save it instead
      const fallback = () => {
        save(file!, file!.name);
        toast.success(`Couldn't open the share menu, so ${file!.name} was downloaded instead`);
      };
      if (!navigator.canShare?.({ files: [file] })) return fallback();
      try {
        await navigator.share({ files: [file], title: file.name });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "NotAllowedError")) throw e;
        if (retry) return fallback();
        throw new Error("The file is ready — tap Share again.");
      }
    });
  const sendEmail = () =>
    run(async () => {
      const res = await fetch("/api/items/export/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, note: note.trim() || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(typeof b?.detail === "string" ? b.detail : "Could not send the email — please try again.");
      }
      toast.success(`Sent to ${email}`);
      onClose();
    });

  const LBL = "flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-slate-400";
  const STEP = "inline-flex size-5 items-center justify-center rounded-full border border-[var(--rt-amber)] text-[10px] font-semibold text-[var(--rt-amber)]";
  const soldCount = items.filter((i) => i.status === "sold").length;
  const scopes: [ExportScope, string, string][] = [
    ["shown", `Shown now (${shown.length})`, `${tabLabel}, with your filters`],
    ["all", `Everything (${items.length})`, "All listings, sold too"],
    ["stack", "One Stakk", stacks.length ? "Pick a Stakk below" : "No Stakks yet"],
    ["sold", `Sales only (${soldCount})`, "Sold, for your records"],
  ];
  const vias = [
    ["download", "Download", Download],
    ...(canShare ? [["share", "Share", Share2] as const] : []),
    ...(full ? [["email", "Email", Mail] as const] : []),
  ] as const;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Export to Excel</DialogTitle>
          <DialogDescription>An editable spreadsheet for Excel, Google Sheets, Numbers and the phone apps.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <p className={LBL} id="export-scope-label">
              <span className={STEP}>1</span> What to include
            </p>
            <div role="radiogroup" aria-labelledby="export-scope-label" className="grid grid-cols-2 gap-2">
              {scopes.map(([value, title, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={scope === value}
                  disabled={value === "stack" && stacks.length === 0}
                  data-testid={`export-scope-${value}`}
                  onClick={() => setScope(value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    scope === value ? "border-sky-500 bg-sky-950/50 text-slate-100" : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="block font-medium">{title}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
            {scope === "stack" && stacks.length > 0 && (
              <Select value={stackId} onValueChange={setStackId} items={stacks.map((s) => ({ value: s.id, label: s.name }))}>
                <SelectTrigger className="h-9 w-full" aria-label="Stakk to export" data-testid="export-stack">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stacks.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className={`flex items-center gap-2 text-sm ${full ? "text-slate-300" : "text-slate-500"}`}>
              <input
                type="checkbox"
                checked={full && perStack}
                disabled={!full}
                onChange={(e) => setPerStack(e.target.checked)}
                className="size-4 accent-sky-500"
                data-testid="export-per-stack"
              />
              Add a sheet for each Stakk{!full && " · Collector"}
            </label>
            <div className="grid grid-cols-3 gap-2 pt-1" data-testid="export-summary">
              {(
                [
                  ["Listings", String(count), "text-slate-100"],
                  ["Asking value", formatAud(asking), "text-amber-300"],
                  ["Realized", formatAud(realized), "text-emerald-300"],
                ] as const
              ).map(([t, v, c]) => (
                <div key={t} className="rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{t}</p>
                  <p className={`truncate font-mono text-sm font-semibold tabular-nums ${c}`}>{v}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500" data-testid="export-sheets">
              {full ? (
                "Opens on a Summary sheet (totals by status and Stakk), then Listings and Sales."
              ) : (
                <>
                  One Listings sheet, sold ones included. The Summary, Sales and per-Stakk sheets and sending by email come with the Collector plan.{" "}
                  <a href="/support" className="font-medium text-sky-300 underline-offset-2 hover:underline">
                    Support
                  </a>
                </>
              )}
            </p>
          </section>

          <section className="space-y-2.5">
            <p className={LBL}>
              <span className={STEP}>2</span> Get the file
            </p>
            {/* the picker only when there's a choice; with Download alone the button below is enough */}
            {vias.length > 1 && (
            <div role="tablist" className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950/40 p-1">
              {vias.map(([value, title, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={via === value}
                  onClick={() => setVia(value)}
                  data-testid={`export-via-${value}`}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${via === value ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
                >
                  <Icon className="size-4" /> {title}
                </button>
              ))}
            </div>
            )}
            {via === "email" && (
              <div className="space-y-2">
                {/* always your own account email: the address you confirmed */}
                <p className="text-sm text-slate-400" data-testid="export-email">
                  {verified ? (
                    <>
                      Sends to <b className="font-semibold break-all text-slate-200">{email}</b>
                    </>
                  ) : (
                    <>Confirm your email first (check your inbox): the file is sent to {email}.</>
                  )}
                </p>
                <Textarea rows={2} placeholder="Note to yourself (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="export-note" />
              </div>
            )}
            <Button
              className="w-full"
              disabled={busy || count === 0 || (via === "email" && !verified)}
              onClick={via === "download" ? download : via === "share" ? share : sendEmail}
              data-testid={via === "download" ? "export-download" : via === "share" ? "export-share" : "export-send"}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {via === "download" ? "Download .xlsx" : via === "share" ? "Share…" : "Send email"}
            </Button>
            <p className="text-center font-mono text-xs text-slate-500" data-testid="export-filename">
              {count === 0 ? "Nothing to export here" : exportName(label)}
            </p>
          </section>

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

// Shown over the listings until the account has a name; it can't be closed without one.
function NameRequiredDialog({ onSaved }: { onSaved: (user: User) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await apiPatch<User>("/auth/me", { name: name.trim() }));
    } catch (err) {
      setError(errorText(err, "Couldn't save your name. Try again."));
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false} data-testid="name-required-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Welcome to CardStakk</DialogTitle>
          <DialogDescription>What should we call you? You can change it later in Account settings.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Input
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            aria-invalid={!!error}
            data-testid="name-required-input"
          />
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!name.trim() || saving} data-testid="name-required-submit">
            {saving ? "Saving…" : "Continue"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
