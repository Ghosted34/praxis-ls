/**
 * Skeleton shimmer for loading states (nicer than a bare spinner on tables).
 *
 * Why shapes rather than a spinner: a spinner says "something is happening";
 * a skeleton says "this is what is about to be here". It also stops the layout
 * jumping when the data lands, because the placeholder already occupies the
 * space the real content will take.
 *
 * Which one to use:
 *   PageSkeleton   the whole screen is still loading (a page-level
 *                  `if (loading) return …`) — draws header, toolbar and rows.
 *   SkeletonTable  the page header is already on screen and only the list slot
 *                  is pending — this is the common case in this codebase.
 *   LoadingRow     (in ui/states) genuinely inline: inside a modal, an expanding
 *                  panel, or next to a button. A skeleton there is overkill.
 */
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  // --ink-3 is a bare channel triplet, so the alpha here is reliable (unlike the
  // full-rgb semantic tokens, where Tailwind opacity modifiers don't apply).
  return <div className={cn("animate-pulse rounded-md bg-[rgb(var(--ink-3)/0.15)]", className)} />;
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="lux-card space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Full-screen loading shape: title + subtitle, a toolbar strip, then rows.
 * `tiles` adds a metric-tile band above the list, for the dashboard-style
 * screens that lead with KPI cards rather than going straight into a table.
 */
export function PageSkeleton({
  tiles = 0,
  rows = 6,
  cols = 4,
}: {
  tiles?: number;
  rows?: number;
  cols?: number;
}) {
  return (
    <section className="animate-fade-in" role="status" aria-label="Loading page">
      <header className="mb-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="ml-auto h-9 w-36" />
      </div>

      {tiles > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: tiles }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      <SkeletonTable rows={rows} cols={cols} />
      <span className="sr-only">Loading…</span>
    </section>
  );
}
