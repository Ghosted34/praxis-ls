import * as React from "react";
import { cn } from "@/lib/cn";
import { tStatic } from "@/lib/i18n";
import { AlertIcon, CheckIcon, SearchIcon } from "@/components/ui/icons";

/**
 * The four presentation states, and the two outcome states, in one place.
 *
 * `doc/PUBLIC_WEB_PLAN.md` §3.3 makes these a prerequisite rather than a
 * convenience: every list, panel and form on this app owes a visitor a designed
 * answer for **loading**, **empty**, **not-found** and **error**, and the way
 * that requirement is normally missed is not carelessness — it is that each page
 * invents its own, four pages later they disagree, and the two nobody
 * screenshots (not-found and error) end up as a bare sentence or an `alert()`.
 * One module, imported everywhere, is how they stay designed.
 *
 * ── WHY NOT-FOUND IS NOT A KIND OF EMPTY ───────────────────────────────────
 *
 * "No shipment matches that reference" and "this shipment has no milestones yet"
 * are different facts with different next actions, and folding them together
 * tells a client whose file was opened this morning that their reference is
 * wrong. They get separate components on purpose, with different glyphs, so the
 * distinction cannot be lost by passing a different string.
 *
 * ── WHY THE ERROR STATE TAKES A REQUEST ID ─────────────────────────────────
 *
 * `middleware/request-id.js` stamps every response with `X-Request-Id`, and
 * `lib/api.ts` now keeps it on the error. A visitor who writes "the tracking
 * page failed" gives support nothing; one who quotes eight characters gives them
 * the exact request. It is the only diagnostic detail this app prints, and it is
 * printed precisely because it means nothing to anyone but us.
 *
 * ── WHAT WAS DELIBERATELY LEFT OUT ─────────────────────────────────────────
 *
 *   · NO offline substitution. The staff `ErrorState` swaps itself for a branded
 *     `ConnectionLost` panel when its connection monitor says the server is
 *     unreachable. That monitor is app furniture; here a failed read on a public
 *     page prints in place, and `app/offline-gate.tsx` handles the one case where
 *     the browser genuinely says it is offline.
 *   · `action` on `ErrorState` is not decoration — on a page a stranger reads, an
 *     error with no retry is a dead end, and a dead end on a marketing site is a
 *     lost enquiry. So it is a first-class prop rather than an escape hatch.
 *
 * `role="img"` on the spinner is deliberate: axe refuses `aria-label` on a bare
 * span (role "generic" prohibits it), and a spinner IS an image for a11y purposes.
 */
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
 * The loading state — a wrapper, because only the caller knows the shape.
 *
 * §3.3 asks for "a skeleton of the real shape. Never a spinner on a blank page",
 * which is a requirement no shared component can satisfy on its own: a generic
 * one would have to guess, and a guess is a spinner with rounded corners. So
 * this contributes the parts that are the same everywhere — the polite live
 * region, the label a screen reader announces, the fade that stops the swap
 * flashing — and the page supplies `<Skeleton>`s in its own layout.
 *
 * `aria-busy` rather than `aria-live`: the region is not announcing a change,
 * it is saying the content under it is not final yet.
 */
export const LoadingState = ({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) => (
  <div
    role="status"
    aria-busy="true"
    aria-label={label || tStatic("states.loading")}
    className={cn("animate-fade-in", className)}
  >
    {children}
  </div>
);

export const EmptyState = ({
  title,
  hint,
  action,
  icon,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "rounded-xl border border-dashed p-10 text-center",
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
      <p className="mx-auto mt-1 max-w-measure text-sm text-muted-foreground">
        {hint}
      </p>
    )}
    {action && (
      <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
    )}
  </div>
);

/**
 * Nothing matched what the visitor asked for — as distinct from there being
 * nothing to show.
 *
 * A magnifier rather than a warning triangle, and a solid border rather than the
 * dashed one `EmptyState` uses: a dashed outline reads as a placeholder waiting
 * to be filled, which is right for "no milestones yet" and wrong for an answer.
 * This one IS the answer.
 */
export const NotFoundState = ({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div
    role="status"
    className={cn(
      "rounded-xl border bg-muted/40 p-10 text-center",
      className,
    )}
  >
    <span
      aria-hidden
      className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--ink)/0.06)] text-muted-foreground"
    >
      <SearchIcon size={20} />
    </span>
    <p className="font-medium">{title}</p>
    {hint && (
      <p className="mx-auto mt-1.5 max-w-measure text-sm text-muted-foreground">
        {hint}
      </p>
    )}
    {action && (
      <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>
    )}
  </div>
);

export const ErrorState = ({
  message,
  action,
  requestId,
  className,
}: {
  message: string;
  action?: React.ReactNode;
  /** `X-Request-Id` from the failed response, where the client captured one. */
  requestId?: string | null;
  className?: string;
}) => (
  <div
    role="alert"
    className={cn(
      "flex items-start gap-3 rounded-xl border border-[rgb(var(--bad-fill)/0.35)] bg-[rgb(var(--bad-fill)/0.07)] p-4 text-sm",
      className,
    )}
  >
    <AlertIcon size={18} className="mt-0.5 text-[rgb(var(--bad))]" />
    <div className="min-w-0 flex-1">
      <p className="text-foreground">{message}</p>
      {requestId && (
        <p className="mt-2 text-xs text-muted-foreground">
          {tStatic("states.requestRef")}{" "}
          <code className="num select-all break-all">{requestId}</code>
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  </div>
);

/** The success counterpart of ErrorState, for the one thing every intake form
 *  does after it posts: tell a stranger it worked, and what happens next.
 *  `role="status"` (polite) so it is announced without interrupting. */
export const SuccessState = ({
  title,
  hint,
  className,
}: {
  title: string;
  hint?: React.ReactNode;
  className?: string;
}) => (
  <div
    role="status"
    className={cn(
      "flex items-start gap-3 rounded-xl border border-[rgb(var(--ok-fill)/0.35)] bg-[rgb(var(--ok-fill)/0.07)] p-4 text-sm",
      className,
    )}
  >
    <CheckIcon size={18} className="mt-0.5 text-[rgb(var(--ok))]" />
    <div className="min-w-0">
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
    </div>
  </div>
);
