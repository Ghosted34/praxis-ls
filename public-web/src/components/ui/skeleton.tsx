import { cn } from "@/lib/cn";

/**
 * Skeleton shimmer for loading states. Ported from `client/src/components/ui/
 * skeleton.tsx` unchanged in shape and purpose: a spinner says "something is
 * happening", a skeleton says "this is what is about to be here" — and it stops
 * the layout jumping when the data lands, which on a public page is the
 * difference between a page that reflows under somebody's thumb and one that
 * does not.
 *
 * The `prefers-reduced-motion` guard the client's version does not have is added
 * here: `animate-pulse` on a page a visitor may be reading slowly, on a phone,
 * is exactly the motion that rule exists for.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[rgb(var(--ink)/0.08)] motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function SkeletonTable({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
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

/** Whole-page shape: title band, then rows. `tiles` adds a metric strip above. */
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
    <section
      className="animate-fade-in"
      role="status"
      aria-label="Loading page"
    >
      <header className="mb-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </header>
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
