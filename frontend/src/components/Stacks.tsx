import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatAud, formatDate } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem, type Stack } from "@/lib/types";
import { Menu } from "@base-ui/react/menu";
import { FolderThumb } from "@/components/ItemCard";
import { rarityClass } from "@/components/badges";
import { ArrowDown, ArrowUp, Check, Ellipsis, FolderInput, GripVertical, Layers, Lock, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";
export const NO_STACK = "none"; // the "Not in a stack" filter

// Sidebar list of stacks: click one to show only its listings. Each row is just the name and count;
// store / back to sale / rename / delete sit in its ⋯ menu. Past 6 stacks the list stays short
// (your top 6 in drag order, "Show more" for the rest) and a filter box finds any stack.
const SHORT_LIST = 6; // more than this: the filter box shows
export function StacksPanel({
  stacks,
  counts,
  forSale,
  stored,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onStore,
  onUnstore,
  onReorder,
  items = [],
  onShowMany,
}: {
  stacks: Stack[];
  counts: Record<string, number>; // listings per stack id, sold included (NO_STACK: only those not sold)
  forSale: Record<string, number>; // per stack: For Sale listings (can go to Storage together)
  stored: Record<string, number>; // per stack: listings in Storage (can come back together)
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (stack: Stack) => void;
  onStore: (stack: Stack) => void; // whole stack to Storage
  onUnstore: (stack: Stack) => void; // whole stack back to For Sale
  onReorder: (ids: string[]) => void; // drag and drop: every stack id in the new order
  items?: CollectionItem[]; // every listing, sold ones too: for the Combine totals
  onShowMany?: (ids: string[]) => void; // Combine → "Show their listings"
}) {
  // Combine: tick several Stakks to add up their sales (separate from the account-wide Realized sales)
  const [combine, setCombine] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [query, setQuery] = useState("");
  const long = stacks.length > SHORT_LIST;
  const q = query.trim().toLowerCase();
  const shown = q
    ? stacks.filter((s) => s.name.toLowerCase().includes(q))
    : stacks; // the Stakks window has room for all of them
  const drop = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      const all = stacks.map((x) => x.id);
      const down = all.indexOf(dragId) < all.indexOf(targetId);
      const ids = all.filter((id) => id !== dragId);
      ids.splice(ids.indexOf(targetId) + (down ? 1 : 0), 0, dragId); // moving down lands below the row, up above it
      onReorder(ids);
    }
    setDragId(null);
    setOverId(null);
  };
  // one place up or down (from the ⋯ menu — works on phones and keyboards too)
  const step = (id: string, dir: -1 | 1) => {
    const ids = stacks.map((x) => x.id);
    const i = ids.indexOf(id);
    if (i + dir < 0 || i + dir >= ids.length) return;
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    onReorder(ids);
  };
  const row = (active: boolean) =>
    `flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
      active ? "bg-sky-500/15 font-semibold text-[var(--rt-text)] ring-1 ring-sky-500/60" : "text-slate-200 hover:bg-slate-800/60"
    }`;
  const item = "flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-slate-800";
  const add = () => {
    if (newName.trim()) onCreate(newName.trim());
    setNewName("");
    setAdding(false);
  };
  return (
    <section data-testid="stacks-panel" className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Stakks</p>
        {stacks.length > 1 && (
          <button
            type="button"
            aria-pressed={combine}
            onClick={() => {
              setCombine((c) => !c);
              setPicked([]);
            }}
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${combine ? "border-[var(--rt-amber)] bg-[var(--rt-amber)] text-[var(--rt-cta-ink,#fff)]" : "border-slate-700 text-[var(--rt-text)] hover:border-slate-500"}`}
            data-testid="stacks-combine"
          >
            {combine && <Check className="mr-1 inline size-3" aria-hidden />}
            Combine
          </button>
        )}
        {!combine && selected && (
          <Button variant="link" size="xs" className="h-auto px-0 text-xs font-semibold text-[var(--rt-text)] underline underline-offset-2" onClick={() => onSelect(null)} data-testid="stacks-show-all">
            Clear
          </Button>
        )}
      </div>
      {long && (
        <Input
          placeholder="Filter Stakks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 text-sm"
          aria-label="Filter Stakks"
          data-testid="stacks-filter"
        />
      )}
      <ul className="space-y-0.5">
        {shown.map((s) => (
          <li
            key={s.id}
            className={`group flex items-center gap-1 rounded border-t-2 ${overId === s.id && dragId !== s.id ? "border-sky-400" : "border-transparent"} ${dragId === s.id ? "opacity-40" : ""}`}
            draggable={editing !== s.id}
            onDragStart={(e) => {
              setDragId(s.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", s.name); // Firefox only starts a drag that carries data
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(s.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(s.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            data-testid={`stack-row-${s.id}`}
          >
            {editing === s.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editName.trim() && editName.trim() !== s.name) onRename(s.id, editName.trim());
                  setEditing(null);
                }}
              >
                <Input autoFocus value={editName} maxLength={60} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" aria-label={`New name for ${s.name}`} />
                <Button type="submit" size="icon-xs" variant="ghost" aria-label="Save name"><Check className="size-3.5" /></Button>
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}><X className="size-3.5" /></Button>
              </form>
            ) : (
              <>
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-slate-700 group-hover:text-slate-400" aria-hidden />
                <button
                  type="button"
                  className={row(combine ? picked.includes(s.id) : selected === s.id)}
                  onClick={() => (combine ? togglePick(s.id) : onSelect(selected === s.id ? null : s.id))}
                  {...(combine ? { role: "checkbox", "aria-checked": picked.includes(s.id) } : { "aria-pressed": selected === s.id })}
                  title={s.name}
                  data-testid={`stack-${s.id}`}
                >
                  {combine && (
                    <span
                      aria-hidden
                      className={`grid size-4 shrink-0 place-items-center rounded-[3px] border ${picked.includes(s.id) ? "border-[var(--rt-amber)] bg-[var(--rt-amber)] text-[var(--rt-cta-ink,#fff)]" : "border-slate-500"}`}
                    >
                      {picked.includes(s.id) && <Check className="size-3" strokeWidth={3} />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {(stored[s.id] ?? 0) > 0 && <span className="size-1.5 shrink-0 rounded-full bg-violet-300" title="Has listings in Storage" />}
                  <span className="font-mono text-xs text-slate-500">{counts[s.id] ?? 0}</span>
                </button>
                <Menu.Root>
                  <Menu.Trigger
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-200 data-[popup-open]:bg-slate-800 data-[popup-open]:text-slate-200"
                    aria-label={`More for ${s.name}`}
                    data-testid={`stack-menu-${s.id}`}
                  >
                    <Ellipsis className="size-4" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="z-50 outline-none" align="end" sideOffset={4}>
                      <Menu.Popup className="min-w-44 rounded-md border border-slate-700 bg-[#1a2130] p-1 text-slate-200 shadow-lg outline-none">
                        {(forSale[s.id] ?? 0) > 0 && (
                          <Menu.Item className={`${item} text-violet-300`} onClick={() => onStore(s)} data-testid={`stack-store-${s.id}`}>
                            <Lock className="size-3.5" /> Move to Storage
                          </Menu.Item>
                        )}
                        {(stored[s.id] ?? 0) > 0 && (
                          <Menu.Item className={`${item} text-emerald-300`} onClick={() => onUnstore(s)} data-testid={`stack-unstore-${s.id}`}>
                            <Undo2 className="size-3.5" /> Back to For Sale
                          </Menu.Item>
                        )}
                        {stacks[0]?.id !== s.id && (
                          <Menu.Item className={item} onClick={() => step(s.id, -1)} data-testid={`stack-up-${s.id}`}>
                            <ArrowUp className="size-3.5" /> Move up
                          </Menu.Item>
                        )}
                        {stacks[stacks.length - 1]?.id !== s.id && (
                          <Menu.Item className={item} onClick={() => step(s.id, 1)} data-testid={`stack-down-${s.id}`}>
                            <ArrowDown className="size-3.5" /> Move down
                          </Menu.Item>
                        )}
                        <Menu.Item className={item} onClick={() => { setEditing(s.id); setEditName(s.name); }} data-testid={`stack-rename-${s.id}`}>
                          <Pencil className="size-3.5" /> Rename
                        </Menu.Item>
                        <Menu.Separator className="my-1 h-px bg-slate-700" />
                        <Menu.Item className={`${item} text-red-400`} onClick={() => onDelete(s)} data-testid={`stack-delete-${s.id}`}>
                          <Trash2 className="size-3.5" /> Delete
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </>
            )}
          </li>
        ))}
        {q && shown.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-500">No Stakk matches “{query.trim()}”.</li>}
        {!combine && <li className="flex items-center gap-1">
          <span className="w-3.5 shrink-0" />
          <button type="button" className={row(selected === NO_STACK)} onClick={() => onSelect(selected === NO_STACK ? null : NO_STACK)} aria-pressed={selected === NO_STACK} data-testid="stack-none">
            <span className="flex-1 text-slate-400">Not in a Stakk</span>
            <span className="font-mono text-xs text-slate-500">{counts[NO_STACK] ?? 0}</span>
          </button>
          <span className="w-6 shrink-0" />
        </li>}
      </ul>
      {combine && (
        <CombinedSales
          names={stacks.filter((s) => picked.includes(s.id)).map((s) => s.name)}
          items={items.filter((i) => i.stack_id && picked.includes(i.stack_id))}
          onShow={onShowMany && (() => onShowMany(picked))}
          onClear={() => setPicked([])}
        />
      )}
      {adding ? (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input autoFocus placeholder="Stakk name, e.g. Sunday market" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" data-testid="stack-new-name" />
          <Button type="submit" size="sm" disabled={!newName.trim()} data-testid="stack-new-save">Add</Button>
        </form>
      ) : (
        <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => setAdding(true)} data-testid="stack-new">
          <Plus className="size-3.5" /> New Stakk
        </Button>
      )}
    </section>
  );
}

// Combine: the ticked Stakks' sales added up — sold for, profit after costs, and what's left unsold.
// Sold records keep their Stakk, so a Stakk's sales stay with it after the sale.
function CombinedSales({ names, items, onShow, onClear }: { names: string[]; items: CollectionItem[]; onShow?: () => void; onClear: () => void }) {
  if (names.length === 0) return <p className="border-t border-slate-800/80 pt-2 text-xs text-slate-500">Tick two or more Stakks to add up their sales.</p>;
  const sold = items.filter((i) => i.status === "sold");
  const soldFor = sold.reduce((t, i) => t + saleTotal(i), 0);
  const profits = sold.map(saleProfit);
  const profit = profits.reduce<number>((t, p) => t + (p ?? 0), 0);
  const noCost = profits.filter((p) => p == null).length;
  const unsold = items.filter((i) => i.status !== "sold").reduce((t, i) => t + i.price * i.quantity, 0);
  const units = sold.reduce((t, i) => t + i.quantity, 0);
  const ROW = "flex items-baseline justify-between gap-3 py-0.5";
  return (
    <section className="space-y-1.5 border-t border-slate-800/80 pt-2" aria-live="polite" data-testid="stacks-combined">
      <p className={LABEL} title={names.join(", ")}>
        {names.length} {names.length === 1 ? "Stakk" : "Stakks"} combined
      </p>
      <div className="text-sm">
        <p className={ROW}>
          <span className="text-slate-400">Sold for</span>
          <span className="font-mono font-semibold tabular-nums text-[var(--rt-text)]">
            {formatAud(soldFor)} <span className="font-normal text-slate-500">({units} sold)</span>
          </span>
        </p>
        <p className={ROW}>
          <span className="text-slate-400">Profit after costs</span>
          <span className={`font-mono font-semibold tabular-nums ${profit < 0 ? "text-red-400" : "text-emerald-300"}`}>
            {profit < 0 ? "−" : "+"}
            {formatAud(Math.abs(profit))}
          </span>
        </p>
        {noCost > 0 && (
          <p className="text-xs text-slate-500">
            {noCost} {noCost === 1 ? "sale has" : "sales have"} no bought price, so {noCost === 1 ? "it isn't" : "they aren't"} in the profit.
          </p>
        )}
        <p className={ROW}>
          <span className="text-slate-400">Unsold value</span>
          <span className="font-mono font-semibold tabular-nums text-[var(--rt-text)]">{formatAud(unsold)}</span>
        </p>
      </div>
      <div className="flex gap-1.5">
        {onShow && (
          <Button size="sm" className="flex-1" onClick={onShow} data-testid="stacks-combined-show">
            Show their listings
          </Button>
        )}
        <Button size="sm" variant="outline" className="flex-1" onClick={onClear} data-testid="stacks-combined-clear">
          Clear
        </Button>
      </div>
    </section>
  );
}

// "Move to stack" for one listing or the selected ones: pick a stack (or none), or name a new one.
export function StackDialog({
  title,
  stacks,
  current,
  onPick,
  onCreateAndPick,
  onClose,
  pending,
}: {
  title: string; // e.g. "Gundam" or "3 listings"
  stacks: Stack[];
  current: string | null | undefined; // the listing's stack now (one listing only)
  onPick: (stackId: string | null) => void;
  onCreateAndPick: (name: string) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [newName, setNewName] = useState("");
  // More than 5 stacks: a dropdown instead of a long list of buttons.
  const many = stacks.length > 5;
  // several listings (current undefined): nothing picked yet, so one click on Move can't empty their stacks
  const [picked, setPicked] = useState<string>(current === undefined ? "" : (current ?? NO_STACK));
  const items = [...stacks.map((s) => ({ value: s.id, label: s.name })), { value: NO_STACK, label: "No Stakk" }];
  const shownItems = [{ value: "", label: "Choose a Stakk…" }, ...items]; // label for the empty choice
  const option = (active: boolean) =>
    `flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
      active ? "border-sky-500 bg-sky-950/50 text-sky-100" : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-500"
    }`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="stack-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Move to Stakk</DialogTitle>
          <DialogDescription>{title} — a listing sits in one stack at a time.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {many ? (
            <div className="flex items-center gap-1.5">
              <Select value={picked} onValueChange={(v) => setPicked(v || "")} items={shownItems}>
                <SelectTrigger className="h-9 flex-1" aria-label="Stakk" data-testid="stack-dialog-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((s) => (
                    <SelectItem key={s.value} value={s.value} data-testid={`stack-pick-${s.value}`}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={pending || picked === "" || (current !== undefined && picked === (current ?? NO_STACK))}
                onClick={() => onPick(picked === NO_STACK ? null : picked)}
                data-testid="stack-dialog-move"
              >
                <FolderInput className="size-4" /> Move
              </Button>
            </div>
          ) : (
          <>
          {stacks.map((s) => (
            <button key={s.id} type="button" className={option(current === s.id)} disabled={pending} onClick={() => onPick(s.id)} data-testid={`stack-pick-${s.id}`}>
              {s.name}
              {current === s.id && <Check className="size-4 text-sky-300" />}
            </button>
          ))}
          <button type="button" className={option(current === null)} disabled={pending} onClick={() => onPick(null)} data-testid="stack-pick-none">
            <span className="text-slate-400">No Stakk</span>
            {current === null && <Check className="size-4 text-sky-300" />}
          </button>
          </>
          )}
          <form
            className="mt-1 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) onCreateAndPick(newName.trim());
            }}
          >
            <Input placeholder="…or a new Stakk" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="h-9" data-testid="stack-dialog-new" />
            <Button type="submit" disabled={!newName.trim() || pending}>
              <FolderInput className="size-4" /> Move
            </Button>
          </form>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A Stakk in the listings grid: shaped like a listing card so the rows line up — a header, the first
// four pictures, the name on a dark fade, its value (Collector and up) and Open. Click anywhere to open it.
// It's an <article> like a listing, so every theme gives it the same panel, border and cut corners.
const FOLDER_FADE = { background: "linear-gradient(to top, rgba(11,15,23,0.95), rgba(11,15,23,0.75) 45%, rgba(11,15,23,0))" };
// total: everything in the Stakk, sold included (the tile itself shows the current tab's listings)
export function StackFolder({ name, items, total, value, onOpen }: { name: string; items: CollectionItem[]; total: number; value: number | null; onOpen: () => void }) {
  const count = `${total} ${total === 1 ? "listing" : "listings"}`;
  return (
    <article
      data-testid="stack-folder"
      onClick={onOpen}
      className="group flex w-full cursor-pointer flex-col gap-2.5 rounded-xl border border-slate-800/80 bg-[#10151F] p-2.5 transition-colors duration-200 hover:border-sky-500/40"
    >
      <span className="flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-md border border-slate-700 text-slate-500">
          <Layers className="size-3.5" aria-hidden />
        </span>
        <span className="truncate font-mono text-xs font-semibold tracking-wide text-slate-300">STAKK · {count}</span>
      </span>
      <span className="item-photo-backdrop relative block aspect-[63/88] overflow-hidden rounded-md border border-slate-800/80">
        <span className="absolute inset-0 grid grid-cols-2 content-start gap-1.5 px-[9%] pt-[9%]">
          {items.slice(0, 4).map((item) => (
            <span key={item.id} className="block aspect-[63/88] overflow-hidden rounded-sm shadow-md transition group-hover:scale-[1.02]">
              <FolderThumb item={item} />
            </span>
          ))}
        </span>
        <span className="absolute inset-x-0 bottom-0 px-2 pt-10 pb-2" style={FOLDER_FADE}>
          <span className="block truncate text-sm font-bold text-white" title={name}>
            {name}
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 rounded-md border border-slate-800/60 bg-slate-950/40 px-2 py-1.5 text-xs">
        <span className="text-slate-500">{value === null ? "Listings" : "Value"}</span>
        <span className="font-mono font-semibold tabular-nums text-sky-300">{value === null ? total : formatAud(value)}</span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="mt-auto h-8 w-full font-semibold tracking-wide"
        aria-label={`Open Stakk ${name}, ${count}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        Open
      </Button>
    </article>
  );
}

// Inside an open folder: what this stack has sold so far (sold records keep their stack).
// The totals (value, sales, profit) sit at the top of the folder, for Tier 1 and up.
export function StackSales({ sold }: { sold: CollectionItem[] }) {
  if (sold.length === 0) return <p className="text-sm text-slate-500" data-testid="stack-sales-empty">Nothing sold from this Stakk yet.</p>;
  const newest = [...sold].sort((a, b) => (b.deal_date ?? "").localeCompare(a.deal_date ?? ""));
  return (
    <section className="space-y-2" data-testid="stack-sales">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={LABEL}>Sold from this Stakk</p>
        <p className="font-mono text-sm tabular-nums text-slate-500">{sold.length} sold</p>
      </div>
      <ul className="max-h-48 divide-y divide-slate-800/80 overflow-y-auto rounded-md border border-slate-800/80 text-sm">
        {newest.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
            {/* name, then which card it was (cards share names across sets and rarities): number + rarity */}
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-slate-200">
                {i.name}
                {i.quantity > 1 && <span className="text-slate-500"> ×{i.quantity}</span>}
              </span>
              {(i.card_no ?? i.set_code) && <span className="shrink-0 font-mono text-xs text-slate-400">{i.card_no ?? i.set_code}</span>}
              {i.rarity && (
                <span className={`shrink-0 rounded border px-1 font-mono text-[10px] font-semibold ${rarityClass(i.rarity)}`}>{i.rarity}</span>
              )}
            </span>
            <span className="hidden truncate text-xs text-slate-500 sm:block">
              {i.buyer_name}
              {i.deal_date && ` · ${formatDate(i.deal_date)}`}
            </span>
            <span className="font-mono tabular-nums text-emerald-300">{formatAud(saleTotal(i))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
