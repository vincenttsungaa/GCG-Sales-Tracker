import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number; // 1-based
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  testId?: string; // two of these on one page (above and below the list) need their own test ids
}

/** Page numbers to show: always first, last, and the current page ±1, with "…" gaps. */
function pageList(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export default function Pagination({ page, pageCount, pageSize, total, onPageChange, testId = "pagination" }: PaginationProps) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-xs text-slate-500" data-testid={`${testId}-summary`}>
        Showing <span className="font-mono tabular-nums text-slate-300">{first}–{last}</span> of{" "}
        <span className="font-mono tabular-nums text-slate-300">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          data-testid={`${testId}-prev`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" /> Prev
        </Button>
        {pageList(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-slate-600" aria-hidden>
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "secondary" : "ghost"}
              size="icon-sm"
              data-testid={`${testId}-page-${p}`}
              aria-label={`Page ${p}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPageChange(p)}
              className="font-mono text-xs tabular-nums"
            >
              {p}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="sm"
          data-testid={`${testId}-next`}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="size-4" />
        </Button>
        {/* jump straight to a page: type its number, then Enter */}
        <form
          className="ml-1 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("page") as HTMLInputElement;
            // min / max / whole numbers are checked by the browser before this runs
            if (input.value) onPageChange(Number(input.value));
            input.value = "";
          }}
        >
          <label htmlFor={`${testId}-goto`} className="text-xs text-slate-500">
            Go to
          </label>
          <input
            id={`${testId}-goto`}
            name="page"
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount}
            placeholder={String(page)}
            aria-label={`Go to page (1–${pageCount})`}
            data-testid={`${testId}-goto`}
            className="h-7 w-14 rounded-md border border-slate-800 bg-slate-950/60 px-2 font-mono text-xs tabular-nums text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
          />
        </form>
      </div>
    </nav>
  );
}
