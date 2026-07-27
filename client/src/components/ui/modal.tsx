/**
 * Minimal portal-based modal — the shell every finance write form opens into.
 * Renders into document.body so it escapes the app-shell stacking context.
 * Closes on backdrop click and Escape; locks body scroll while open. No
 * dependency — matches the design system (lux-card surface, muted overlay).
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-fade-in sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={cn("animate-modal-rise my-8 w-full rounded-[22px] border bg-background p-6 shadow-[var(--shadow-l)]", width)}>
        <header className="mb-4">
          <h2 className="font-display text-xl tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </header>
        {children}
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
