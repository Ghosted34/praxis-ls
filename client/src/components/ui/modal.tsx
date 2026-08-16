/**
 * Modal — now an ALIAS of `<Dialog>` (components/ui/dialog.tsx).
 *
 * The hand-rolled implementation that lived here handled Escape and body-scroll
 * lock and nothing else. It had NO FOCUS TRAP (Tab moved focus behind the
 * dialog, into controls the backdrop hid) and NO FOCUS RESTORATION (on close,
 * focus was lost to <body>) — WCAG 2.1 §2.4.3, at every write surface in the
 * product (audit F13).
 *
 * Rather than edit the 56 files that import `Modal`, this re-exports the Radix
 * implementation under the old name and the identical prop contract, so all 56
 * inherit the focus trap, focus restore and proper `aria-labelledby` /
 * `aria-describedby` wiring without being touched. Same incremental-shim
 * approach as `lib/use-resource`.
 *
 * NEW CODE SHOULD IMPORT `Dialog` DIRECTLY. This alias exists to carry the
 * existing screens across, not to be the long-term name.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export { Dialog as Modal, ConfirmDialog } from "@/components/ui/dialog";

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
  /**
   * A node, not just a string, so a field can carry a small badge beside its
   * name — "from the file", "suggested — check it" on a prefilled form.
   *
   * Widened rather than adding a separate `labelSuffix` prop: the badge belongs
   * INSIDE the <label>, so it is part of the control's accessible name and a
   * screen-reader user hears "Direction, suggested — check it" rather than
   * meeting a caption they have no way to associate with the field. A sibling
   * prop rendered outside the label could not do that.
   *
   * Still keep it short and still a NOUN — see the note above.
   */
  label: React.ReactNode;
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

  const only =
    React.Children.count(children) === 1
      ? React.Children.toArray(children)[0]
      : null;
  const single = React.isValidElement(only)
    ? (only as React.ReactElement<Record<string, unknown>>)
    : null;

  const ownId = single?.props?.id;
  const controlId =
    htmlFor ?? (typeof ownId === "string" ? ownId : `${uid}-control`);

  const control = single
    ? React.cloneElement(single, {
        id: controlId,
        "aria-labelledby": single.props["aria-labelledby"] ?? labelId,
        "aria-describedby":
          [single.props["aria-describedby"], describedBy]
            .filter(Boolean)
            .join(" ") || undefined,
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { "aria-required": true } : {}),
      })
    : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        id={labelId}
        htmlFor={controlId}
        className="block text-sm font-medium text-foreground"
      >
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
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
        >
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
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
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
));
Select.displayName = "Select";
