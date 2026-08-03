/**
 * Shows whatever `reportActionError` last reported.
 *
 * Mounted once in the app shell so retrofitted screens need no render changes
 * (see lib/action-error.ts for why). Dismissible, and clears itself on route
 * change — an error about a purchase request shouldn't follow you to Fleet.
 *
 * Not a toast queue on purpose: one message at a time, and it stays until it is
 * dismissed or the route changes. These are refusals a user needs to read
 * ("You raised this item — it must be decided by someone else"), not
 * notifications to glance at.
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { useActionError, clearActionError } from "@/lib/action-error";

export function ActionErrorBanner() {
  const message = useActionError();
  const { pathname } = useLocation();

  React.useEffect(() => {
    clearActionError();
  }, [pathname]);

  if (!message) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-[4.5rem] z-[60] mx-auto flex w-[min(46rem,calc(100%-2rem))] items-start gap-3 rounded-lg border border-[rgb(var(--bad))] bg-[rgb(var(--bad)/0.12)] px-4 py-3 shadow-l backdrop-blur"
    >
      <span className="mt-0.5 shrink-0 text-[rgb(var(--bad))]" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" strokeLinecap="round" />
        </svg>
      </span>
      <p className="min-w-0 flex-1 text-sm text-foreground">{message}</p>
      <button
        type="button"
        onClick={clearActionError}
        aria-label="Dismiss"
        className="shrink-0 rounded px-2 text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
