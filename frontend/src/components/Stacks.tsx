import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatAud, formatDate } from "@/lib/format";
import { saleProfit, saleTotal, type CollectionItem, type Stack } from "@/lib/types";
import { Menu } from "@base-ui/react/menu";
import { FolderThumb } from "@/components/ItemCard";
import { ArrowDown, ArrowUp, Check, Ellipsis, FolderInput, GripVertical, Lock, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";
export const NO_STACK = "none"; // the "Not in a stack" filter

// Sidebar list of stacks: click one to show only its listings. Each row is just the name and count;
// store / back to sale / rename / delete sit in its ⋯ menu. Past 6 stacks the list stays short
// (your top 6 in drag order, "Show more" for the rest) and a filter box finds any stack.
const SHORT_LIST = 6;
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
}: {
  stacks: Stack[];
  counts: Record<string, number>; // listings per stack id (and NO_STACK): For Sale, Pending and Storage
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
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const long = stacks.length > SHORT_LIST;
  const q = query.trim().toLowerCase();
  const shown = q
    ? stacks.filter((s) => s.name.toLowerCase().includes(q))
    : long && !expanded
      ? stacks.filter((s, i) => i < SHORT_LIST || s.id === selected) // the picked stack stays in view
      : stacks;
  const hidden = stacks.length - shown.length;
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
      active ? "bg-sky-950/60 text-sky-100 ring-1 ring-sky-500/60" : "text-slate-200 hover:bg-slate-800/60"
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
        {selected && (
          <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => onSelect(null)} data-testid="stacks-show-all">
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
                <button type="button" className={row(selected === s.id)} onClick={() => onSelect(selected === s.id ? null : s.id)} aria-pressed={selected === s.id} title={s.name} data-testid={`stack-${s.id}`}>
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
        {long && !q && (
          <li>
            <button type="button" className="px-2 py-1 text-xs text-sky-300 hover:underline" onClick={() => setExpanded(!expanded)} data-testid="stacks-more">
              {expanded ? "Show fewer ▴" : `Show ${hidden} more ▾`}
            </button>
          </li>
        )}
        <li className="flex items-center gap-1">
          <span className="w-3.5 shrink-0" />
          <button type="button" className={row(selected === NO_STACK)} onClick={() => onSelect(selected === NO_STACK ? null : NO_STACK)} aria-pressed={selected === NO_STACK} data-testid="stack-none">
            <span className="flex-1 text-slate-400">Not in a Stakk</span>
            <span className="font-mono text-xs text-slate-500">{counts[NO_STACK] ?? 0}</span>
          </button>
          <span className="w-6 shrink-0" />
        </li>
      </ul>
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

// Storage: a stack's listings grouped into one tile, like an iPhone app folder — a mini grid of the
// first nine pictures, the name underneath; click to open it.
export function StackFolder({ name, items, onOpen }: { name: string; items: CollectionItem[]; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="stack-folder"
      onClick={onOpen}
      className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <span className="grid aspect-square w-full grid-cols-3 content-start gap-1.5 rounded-[22%] border border-slate-700/70 bg-slate-700/30 p-[9%] shadow-lg backdrop-blur transition group-hover:scale-[1.03] group-hover:border-sky-500/60">
        {items.slice(0, 9).map((item) => (
          <span key={item.id} className="aspect-square overflow-hidden rounded-[22%] bg-slate-900/80">
            <FolderThumb item={item} />
          </span>
        ))}
      </span>
      <span className="w-full truncate text-sm font-medium text-slate-200">{name}</span>
      <span className="-mt-2 font-mono text-xs text-slate-500">
        {items.length} {items.length === 1 ? "listing" : "listings"}
      </span>
    </button>
  );
}

// Inside an open folder: what this stack has sold so far (sold records keep their stack).
// totalsOnly: just the totals (the Sold tab already shows each sale as a card above).
export function StackSales({ sold, totalsOnly = false }: { sold: CollectionItem[]; totalsOnly?: boolean }) {
  if (sold.length === 0) return <p className="text-sm text-slate-500" data-testid="stack-sales-empty">Nothing sold from this Stakk yet.</p>;
  const realized = sold.reduce((sum, i) => sum + saleTotal(i), 0);
  const profit = sold.reduce((sum, i) => sum + (saleProfit(i) ?? 0), 0);
  const newest = [...sold].sort((a, b) => (b.deal_date ?? "").localeCompare(a.deal_date ?? ""));
  return (
    <section className="space-y-2" data-testid="stack-sales">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={LABEL}>Realized sales</p>
        <p className="font-mono text-sm tabular-nums">
          <span className="text-emerald-300" data-testid="stack-sales-total">{formatAud(realized)}</span>
          <span className="text-slate-500">
            {" "}· {formatAud(Math.abs(profit))} {profit >= 0 ? "profit" : "loss"} · {sold.length} sold
          </span>
        </p>
      </div>
      {!totalsOnly && (
      <ul className="max-h-48 divide-y divide-slate-800/80 overflow-y-auto rounded-md border border-slate-800/80 text-sm">
        {newest.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-slate-200">
              {i.name}
              {i.quantity > 1 && <span className="text-slate-500"> ×{i.quantity}</span>}
            </span>
            <span className="hidden truncate text-xs text-slate-500 sm:block">
              {i.buyer_name}
              {i.deal_date && ` · ${formatDate(i.deal_date)}`}
            </span>
            <span className="font-mono tabular-nums text-emerald-300">{formatAud(saleTotal(i))}</span>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
