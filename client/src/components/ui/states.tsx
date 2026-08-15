/**
 * Loading / empty / error blocks, so screens have real states rather than blank
 * spinners.
 *
 * `EmptyState` gained an `action` slot in Phase 2 (audit F11): it accepted only
 * `title` and `hint`, and NO empty state anywhere in the product offered a
 * primary action — the pattern that turns an empty table into an onboarding
 * step instead of a dead end. Eleven screens had no empty state at all.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { useConnection } from "@/lib/connection";
import { ConnectionLost } from "@/components/connection/connection-lost";

// `role="img"` because axe (rule aria-prohibited-attr) refuses aria-label on a
// bare <span> — a span defaults to role "generic", which does not permit a
// label. img is the semantically correct role for a spinner (it IS a loading
// icon) and axe's screens.axe suite otherwise flagged every page that rendered
// Spinner outside a <LoadingRow> wrapper.
export const Spinner = ({ className }: { className?: string }) => (
  <span
    role="img"
    aria-label="Loading"
    className={cn(
      "inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent",
      className,
    )}
  />
);

export const LoadingRow = ({ label = "Loading…" }: { label?: string }) => (
  <div
    role="status"
    className="flex items-center gap-3 p-6 text-muted-foreground"
  >
    <Spinner /> {label}
  </div>
);

/**
 * EmptyState — nothing here yet, and what to do about it.
 *
 * @example  // a list the user can populate
 * <EmptyState
 *   title="No invoices"
 *   hint="Issue a final invoice from an approved costing."
 *   action={<Button onClick={() => setFormOpen(true)}>New invoice</Button>}
 * />
 *
 * @example  // filtered to nothing — the action CLEARS, it does not create
 * <EmptyState
 *   title="No invoices match"
 *   hint="Try another status or search term."
 *   action={<Button variant="outline" onClick={reset}>Clear filters</Button>}
 * />
 *
 * BEST PRACTICE. Distinguish the two empties: a genuinely new list wants a
 * CREATE action, a filtered-to-nothing list wants a CLEAR action — offering
 * "New invoice" to someone who just mistyped a search is unhelpful. Write `hint`
 * as the next step in the user's words ("Issue a final invoice from an approved
 * costing"), never as a developer's note; the old default, "No records
 * returned.", told an operator nothing.
 */
export const EmptyState = ({
  title,
  hint,
  action,
  icon,
  className,
}: {
  title: string;
  hint?: string;
  /** A single primary control. This is the F11 fix. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "rounded-lg border border-dashed p-10 text-center",
      className,
    )}
  >
    {icon && (
      <span aria-hidden className="mb-3 inline-flex text-muted-foreground">
        {icon}
      </span>
    )}
    <p className="font-medium">{title}</p>
    {hint && (
      <p className="mx-auto mt-1 max-w-reading text-sm text-muted-foreground">
        {hint}
      </p>
    )}
    {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
  </div>
);

/**
 * `role="alert"` so a failure arriving after load is announced, not just drawn
 * — the audit found async failure announced nowhere (F13).
 *
 * OFFLINE IS NOT AN ERROR TO PRINT — IT IS THE OFFLINE PAGE. When the connection
 * monitor says we are unreachable, the string a screen hands us ("Can't reach
 * the server — you appear to be offline.") is the wrong thing to show: it is a
 * red box that names no cause and offers no route out. So this swaps it for the
 * branded `ConnectionLost` — the crafted offline panel, with the opt-in puzzle —
 * exactly as `ScreenError` does. Doing it HERE means every one of the 30-plus
 * screens that fell back to `ErrorState` (the Control Tower among them) gets the
 * offline page for free, without threading connectivity through each call site,
 * and without a hard refresh to reach it.
 *
 * It recovers on its own: the screen's data refetches on reconnect (the query
 * cache is invalidated globally — see `connection-watcher.tsx`), which clears
 * the error branch and unmounts this. A screen that wants to thread a retry
 * label or its own reload uses `<ScreenError>` directly; this is the zero-touch
 * default for everything else.
 */
export const ErrorState = ({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) => {
  const { status } = useConnection();
  // `autoRetry={false}`: the global reconnect invalidation owns the refetch, so
  // this must not also register a per-instance reconnect listener (many screens
  // can be mounted behind tabs, and each would refetch on the same signal).
  if (status === "unreachable")
    return <ConnectionLost autoRetry={false} what="This screen" />;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p>{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
};
