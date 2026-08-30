import * as React from "react";
import { cn } from "@/lib/cn";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

/**
 * Loading / empty / error blocks.
 *
 * Ported from `client/src/components/ui/states.tsx`, minus one thing and plus one
 * thing, both of which are the difference between a public page and an app
 * screen:
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

export const ErrorState = ({
  message,
  action,
  className,
}: {
  message: string;
  action?: React.ReactNode;
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
