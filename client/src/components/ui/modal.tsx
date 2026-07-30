/**
 * Portal-based modal — the shell every write form / detail view opens into.
 * Renders into document.body so it escapes the app-shell stacking context.
 * Closes on backdrop click and Escape; locks body scroll while open.
 *
 * Structured in three regions so tall content behaves: a STICKY header (title +
 * close, plus optional `headerRight` actions), a SCROLLABLE body (children), and
 * an optional STICKY `footer` for primary actions. The card is height-bounded, so
 * only the body scrolls — the header and footer stay put. On mobile it becomes a
 * bottom sheet; on sm+ a centred dialog.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/ui/icons";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  headerRight,
  size = "md",
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Sticky footer content (e.g. Cancel + Save). Rendered right-aligned. */
  footer?: React.ReactNode;
  /** Actions/status shown in the header, left of the close button. */
  headerRight?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  bodyClassName?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === "xl" ? "max-w-3xl" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          "animate-modal-rise flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-background shadow-[var(--shadow-l)] sm:max-h-[calc(100vh-4rem)] sm:rounded-2xl",
          width,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon width={18} height={18} />
            </button>
          </div>
        </header>
        <div className={cn("flex-1 overflow-y-auto px-6 py-5", bodyClassName)}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-[color-mix(in_srgb,var(--muted)_60%,transparent)] px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Labelled form field wrapper — label on top, control below, optional hint/error. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Native select styled to match Input. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        // Solid bg + explicit option colours so the native dropdown list is
        // legible in dark mode (a transparent select renders its option popup
        // with the browser default — light bg + light text = unreadable).
        "flex h-10 w-full rounded-[10px] border border-input bg-background text-foreground px-3 py-2 text-[13px]",
        "[&>option]:bg-background [&>option]:text-foreground",
        "transition-colors focus-visible:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
