/**
 * Pagination — move through a list the server returns in pages.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The audit's F8 describes the hubs as
 * doing "unpaginated fetch-everything-then-filter". Verifying that during Phase
 * 2 turned up something sharper: the API's shared `page()` helper
 * (`src/shared/db/query-helpers.js:47`) DEFAULTS to `limit 50`, capped at 200.
 * So a screen that fetches `/final-invoices` with no params does not get
 * everything — it gets the newest 50 and then filters THOSE client-side. On a
 * tenant with more than 50 invoices, the Finance hub's search box cannot find
 * an older one, and reports nothing wrong.
 *
 * This component is the client half of fixing that. The screen half — passing
 * `?limit=&offset=` and moving search to the server's `?q=` — is per-screen work
 * and belongs to the Phase 3/4 migrations.
 *
 * The control is `<nav>` + real buttons, and it announces the range rather than
 * just the page number: "51–100 of 1,284" tells an operator where they are in a
 * way "Page 2" does not.
 *
 * @example
 * const [page, setPage] = React.useState(0);
 * const limit = 50;
 * const { rows } = useList(`/final-invoices?limit=${limit}&offset=${page * limit}`);
 * …
 * <Pagination page={page} pageSize={limit} onPageChange={setPage} hasMore={rows?.length === limit} />
 *
 * BEST PRACTICE. Pass `total` when the endpoint returns a count — the range
 * readout is far more useful than Prev/Next alone. When it does not, pass
 * `hasMore` (typically `rows.length === pageSize`) and the control degrades to
 * Prev/Next honestly rather than inventing a page count it cannot know.
 */
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { num } from "@/lib/format";

export function Pagination({
  page,
  pageSize,
  total,
  hasMore,
  onPageChange,
  className,
}: {
  /** Zero-based. */
  page: number;
  pageSize: number;
  /** Total row count, when the endpoint reports one. */
  total?: number;
  /** Used when `total` is unknown — typically `rows.length === pageSize`. */
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const from = page * pageSize + 1;
  const to = total === undefined ? (page + 1) * pageSize : Math.min((page + 1) * pageSize, total);
  const canPrev = page > 0;
  const canNext = total === undefined ? !!hasMore : to < total;
  const pageCount = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));

  // Nothing to page through: render nothing rather than a dead control.
  if (!canPrev && !canNext) return null;

  return (
    <nav aria-label="Pagination" className={cn("mt-4 flex items-center justify-between gap-4", className)}>
      {/* aria-live so the range is announced after a page change — otherwise a
          screen-reader user hears only that the button was pressed. */}
      <p aria-live="polite" className="text-label text-muted-foreground">
        {total === undefined ? (
          <>
            Showing {num(from)}–{num(to)}
          </>
        ) : (
          <>
            Showing {num(from)}–{num(to)} of {num(total)}
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => onPageChange(page - 1)} disabled={!canPrev}>
          Previous
        </Button>
        <span className="text-label tabular-nums text-muted-foreground">
          {pageCount === undefined ? `Page ${page + 1}` : `Page ${page + 1} of ${num(pageCount)}`}
        </span>
        <Button variant="outline" onClick={() => onPageChange(page + 1)} disabled={!canNext}>
          Next
        </Button>
      </div>
    </nav>
  );
}
