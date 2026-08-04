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

/**
 * Field — labelled form control: label on top, control below, optional hint or
 * error underneath.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BIGGEST SINGLE ACCESSIBILITY FIX IN THE AUDIT (F4).
 *
 * This wrapper is used by essentially every write form in the product. It used
 * to render a `<label>` with no `htmlFor` against children with no `id`:
 *
 *     <label className="text-sm font-medium">{label}</label>   // points at nothing
 *     {children}                                               // no id, no aria-*
 *
 * The label wrapped nothing and pointed at nothing. Measured across the client:
 *
 *     <Field> render sites                              565
 *     …with label→control association                     0
 *     …passing `required` (a red asterisk and nothing else) 189
 *     …passing `error`                                      4
 *     aria-required / aria-invalid / aria-describedby
 *       anywhere in ~40,000 lines                       0 / 0 / 0
 *
 * That fails WCAG 2.1 §1.3.1 (Info and Relationships), §3.3.2 (Labels or
 * Instructions) and §4.1.2 (Name, Role, Value) at every write surface in an
 * ERP that posts journal entries and runs payroll. A screen-reader user heard
 * "edit text, blank" 565 times; clicking a label did not focus its input;
 * required-ness was conveyed by a red asterisk and nothing else.
 *
 * Because it is one component, the fix is one component.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HOW IT ASSOCIATES. `useId` mints a stable id per field. The child is cloned
 * with that `id` plus the ARIA state, and the label points at it with `htmlFor`.
 * Both association routes are wired deliberately:
 *
 *   htmlFor          gives click-the-label-to-focus, and works for the labelable
 *                    natives (input / select / textarea) that most fields hold.
 *   aria-labelledby  gives the accessible NAME to anything else — a
 *                    `role="radiogroup"` (Segmented), a `role="combobox"`
 *                    (SearchSelect), a composite widget. `htmlFor` cannot
 *                    associate with a div, so on its own it would have left
 *                    every non-native control unnamed.
 *
 * A child that already carries its own `id` keeps it, and the label follows it
 * rather than overwriting.
 *
 * WHEN THE CHILD ISN'T A SINGLE ELEMENT (a fragment, or two inputs side by
 * side) there is nothing to clone, so the children are wrapped in a
 * `role="group"` labelled by the same text. That is the correct pattern for a
 * composite field and keeps the group named rather than silently unlabelled.
 *
 * @example
 * <Field label="Client" required>
 *   <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
 * </Field>
 *
 * @example  // with server-side validation routed to the field
 * <Field label="Amount" required error={errors.amount} hint="Excluding TVA.">
 *   <Input inputMode="decimal" value={form.amount} onChange={…} />
 * </Field>
 *
 * BEST PRACTICE. `label` is required and should be a noun phrase ("Payment
 * due"), not an instruction ("Enter the payment due date") — put that in
 * `hint`, which is announced after the label rather than instead of it. Pass
 * `error` rather than rendering your own message below the field: only then do
 * `aria-invalid` and `aria-describedby` point at it, which is what makes a
 * screen reader announce the problem when focus lands on the control. Never use
 * `placeholder` as the label — it disappears on the first keystroke.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  /** Guidance shown under the control. Announced after the label. */
  hint?: string;
  /** Validation message. Sets aria-invalid and is announced via aria-describedby. */
  error?: string;
  required?: boolean;
  /** Escape hatch: associate with a control that owns its own id elsewhere. */
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const uid = React.useId();
  const labelId = `${uid}-label`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  // Error first: when a field is both invalid and hinted, the problem should be
  // read before the guidance.
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const only = React.Children.count(children) === 1 ? React.Children.toArray(children)[0] : null;
  const single = React.isValidElement(only) ? (only as React.ReactElement<Record<string, unknown>>) : null;

  const ownId = single?.props?.id;
  const controlId = htmlFor ?? (typeof ownId === "string" ? ownId : `${uid}-control`);

  const control = single
    ? React.cloneElement(single, {
        id: controlId,
        "aria-labelledby": single.props["aria-labelledby"] ?? labelId,
        "aria-describedby":
          [single.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { "aria-required": true } : {}),
      })
    : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label id={labelId} htmlFor={controlId} className="block text-sm font-medium text-foreground">
        {label}
        {/* The asterisk is decoration: `aria-required` on the control is what
            actually conveys this, and "Client star" is not a field name. */}
        {required && (
          <span aria-hidden className="text-destructive">
            {" *"}
          </span>
        )}
      </label>

      {control ?? (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {children}
        </div>
      )}

      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
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
