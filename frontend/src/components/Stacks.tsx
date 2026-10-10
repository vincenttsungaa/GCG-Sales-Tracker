import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Stack } from "@/lib/types";
import { Check, FolderInput, Pencil, Plus, Trash2, X } from "lucide-react";

const LABEL = "font-mono text-xs uppercase tracking-wider text-slate-400";
export const NO_STACK = "none"; // the "Not in a stack" filter

// Sidebar list of stacks: click one to show only its listings; name, rename or delete them here.
export function StacksPanel({
  stacks,
  counts,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  stacks: Stack[];
  counts: Record<string, number>; // For Sale + Pending listings per stack id (and NO_STACK)
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (stack: Stack) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const row = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
      active ? "bg-sky-950/60 text-sky-100 ring-1 ring-sky-500/60" : "text-slate-200 hover:bg-slate-800/60"
    }`;
  const add = () => {
    if (newName.trim()) onCreate(newName.trim());
    setNewName("");
    setAdding(false);
  };
  return (
    <section data-testid="stacks-panel" className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between">
        <p className={LABEL}>Stacks</p>
        {selected && (
          <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => onSelect(null)} data-testid="stacks-show-all">
            Show all
          </Button>
        )}
      </div>
      <ul className="space-y-0.5">
        {stacks.map((s) => (
          <li key={s.id} className="group flex items-center gap-1">
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
                <button type="button" className={row(selected === s.id)} onClick={() => onSelect(selected === s.id ? null : s.id)} aria-pressed={selected === s.id} data-testid={`stack-${s.id}`}>
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="font-mono text-xs text-slate-500">{counts[s.id] ?? 0}</span>
                </button>
                <Button size="icon-xs" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label={`Rename ${s.name}`} onClick={() => { setEditing(s.id); setEditName(s.name); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="icon-xs" variant="ghost" className="text-red-400 opacity-60 group-hover:opacity-100" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </li>
        ))}
        <li>
          <button type="button" className={row(selected === NO_STACK)} onClick={() => onSelect(selected === NO_STACK ? null : NO_STACK)} aria-pressed={selected === NO_STACK} data-testid="stack-none">
            <span className="text-slate-400">Not in a stack</span>
            <span className="font-mono text-xs text-slate-500">{counts[NO_STACK] ?? 0}</span>
          </button>
        </li>
      </ul>
      {adding ? (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input autoFocus placeholder="Stack name, e.g. Sunday market" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" data-testid="stack-new-name" />
          <Button type="submit" size="sm" disabled={!newName.trim()} data-testid="stack-new-save">Add</Button>
        </form>
      ) : (
        <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => setAdding(true)} data-testid="stack-new">
          <Plus className="size-3.5" /> New stack
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
  const option = (active: boolean) =>
    `flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
      active ? "border-sky-500 bg-sky-950/50 text-sky-100" : "border-slate-800 bg-slate-950/40 text-slate-200 hover:border-slate-500"
    }`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="stack-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Move to stack</DialogTitle>
          <DialogDescription>{title} — a listing sits in one stack at a time.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {stacks.map((s) => (
            <button key={s.id} type="button" className={option(current === s.id)} disabled={pending} onClick={() => onPick(s.id)} data-testid={`stack-pick-${s.id}`}>
              {s.name}
              {current === s.id && <Check className="size-4 text-sky-300" />}
            </button>
          ))}
          <button type="button" className={option(current === null || current === undefined)} disabled={pending} onClick={() => onPick(null)} data-testid="stack-pick-none">
            <span className="text-slate-400">No stack</span>
            {(current === null || current === undefined) && <Check className="size-4 text-sky-300" />}
          </button>
          <form
            className="mt-1 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) onCreateAndPick(newName.trim());
            }}
          >
            <Input placeholder="…or a new stack" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} className="h-9" data-testid="stack-dialog-new" />
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
