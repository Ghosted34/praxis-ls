/**
 * Dialog — the modal shell every write form and detail view opens into.
 *
 * WHY RADIX (audit F13). The previous hand-rolled `Modal` handled Escape and
 * body-scroll lock and nothing else:
 *
 *   - NO FOCUS TRAP. Tab moved focus behind the dialog, into the page the
 *     dialog was covering, while the backdrop still blocked the mouse. A
 *     keyboard user could tab into controls they could not see.
 *   - NO FOCUS RESTORATION. On close, focus was lost to <body> — so the next
 *     Tab started from the top of the document. WCAG 2.1 §2.4.3 (Focus Order).
 *   - The dialog was labelled with `aria-label={title}` while a visible <h2>
 *     carried the same text, and `description` was never associated at all.
 *
 * This affected every write form in the product. Radix solves exactly this set
 * correctly — trap, restore, `aria-labelledby`/`aria-describedby` wiring,
 * inert-ing the background, and Escape — and it is HEADLESS, so the visual
 * system below is unchanged. That is the whole reason the audit says adopt
 * Radix and NOT a styled kit: the look already exists and works.
 *
 * The API is deliberately identical to the old `Modal`, so the ~100 call sites
 * migrate by changing an import. Structure is the same three regions that made
 * tall content behave: a STICKY header (title + close + optional `headerRight`),
 * a SCROLLABLE body, and an optional STICKY `footer`. On mobile it is a bottom
 * sheet; on sm+ a centred dialog.
 *
 * @example
 * <Dialog open={open} onClose={() => setOpen(false)} title="New client"
 *         description="Creates a master-data record."
 *         footer={<FormButtons busy={saving} onCancel={close} saveLabel="Create client" />}>
 *   <Field label="Name" required><Input … /></Field>
 * </Dialog>
 *
 * BEST PRACTICE. Give every dialog a `title` that names the OUTCOME ("Post
 * journal entry"), not the mechanism ("Form"). Put the primary action in
 * `footer` so it stays visible while the body scrolls — a Save button that
 * scrolls out of a 40-field form is how half-filled records happen. For a
 * destructive action set `destructive` so the confirm reads as a warning.
 * Do not nest dialogs; open the second from a row action after the first closes.
 */
import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { XIcon } from "@/components/ui/icons";

export function Dialog({
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
  size?: "md" | "lg" | "xl" | "wide";
  bodyClassName?: string;
}) {
  // `wide` (1152px) is for dialogs whose body is a WIDE TABLE rather than a
  // form. At `xl` (768px) a seven-column register scrolls horizontally inside a
  // dialog that is itself centred in a 2560px viewport, which is the worst of
  // both — the reader loses the row while the screen sits half empty. Forms do
  // not want it: `max-w-lg` exists because a single-column form at 1152px is
  // unreadable, and that is still true.
  const width =
    size === "wide"
      ? "max-w-6xl"
      : size === "xl"
        ? "max-w-3xl"
        : size === "lg"
          ? "max-w-2xl"
          : "max-w-lg";

  /**
   * Explicit focus restoration.
   *
   * This component's API is `open` / `onClose` rather than a `<Dialog.Trigger>`,
   * because ~100 existing call sites open their modal from state — a row click,
   * a command-palette action, a redirect. With no Trigger, Radix has nothing to
   * return focus TO except whatever `FocusScope` captured at mount, which is
   * exactly the case its default path is weakest at.
   *
   * So the opener is captured here and restored here: `onCloseAutoFocus`
   * suppresses Radix's own attempt (preventDefault) and this runs instead, which
   * makes the behaviour deterministic rather than dependent on what happened to
   * be focused when the portal mounted. WCAG 2.1 §2.4.3 — the failure being
   * fixed is the old Modal dropping focus to <body> on every close.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) openerRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in" />
        <RadixDialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const opener = openerRef.current;
            if (opener?.isConnected) opener.focus();
          }}
          // Radix inert-s the background rather than relying on aria-modal, but
          // several screen readers still switch to forms/browse mode off this
          // attribute, so it is stated explicitly.
          aria-modal="true"
          className={cn(
            "fixed left-1/2 z-50 flex w-full -translate-x-1/2 flex-col overflow-hidden border bg-background shadow-[var(--shadow-l)]",
            // Bottom sheet on phones, centred dialog from sm up — unchanged.
            "bottom-0 max-h-[92vh] rounded-t-2xl",
            "sm:bottom-auto sm:top-1/2 sm:max-h-[calc(100vh-4rem)] sm:-translate-y-1/2 sm:rounded-lg",
            width,
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
            <div className="min-w-0">
              {/* Radix wires this to aria-labelledby. The old Modal duplicated
                  the text into aria-label instead, so the accessible name and
                  the visible heading were two separate strings that could drift. */}
              <RadixDialog.Title className="truncate text-h2 tracking-tight">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-sm text-muted-foreground">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerRight}
              <RadixDialog.Close
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <XIcon width={18} height={18} />
              </RadixDialog.Close>
            </div>
          </header>

          <div
            className={cn("flex-1 overflow-y-auto px-6 py-5", bodyClassName)}
          >
            {children}
          </div>

          {footer && (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-[color-mix(in_srgb,var(--muted)_60%,transparent)] px-6 py-3.5">
              {footer}
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * ConfirmDialog — "are you sure" for an irreversible action.
 *
 * Exists because the audit found confirm-then-delete blocks written
 * independently per feature area, and because in an OHADA ledger the difference
 * between "Delete" and "Delete invoice INV-2026-0041" is the difference between
 * a recoverable mistake and a restatement.
 *
 * @example
 * <ConfirmDialog
 *   open={!!target}
 *   onClose={() => setTarget(null)}
 *   onConfirm={remove}
 *   busy={deleting}
 *   title="Delete rate card?"
 *   body={`"${target?.name}" will stop applying to new quotations.`}
 *   confirmLabel="Delete rate card"
 *   destructive
 * />
 *
 * BEST PRACTICE. Name the object in `body` and the action in `confirmLabel`.
 * "Yes / No" makes the user re-read the title to know what they are agreeing to.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  busy,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /**
   * The confirmation cannot proceed yet — a required attachment is missing, a
   * name has not been typed.
   *
   * Distinct from `busy`, which means "it is already happening". Both grey the
   * button, and conflating them would say "working…" over a dialog that has not
   * started and cannot. Prefer this to letting the press through and reporting a
   * validation error afterwards: a dialog that accepts a click it will refuse is
   * a dialog people click twice.
   */
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-outline h-9 rounded-md px-3 text-sm"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={cn(
              "h-9 rounded-md px-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50",
              destructive ? "bg-[rgb(var(--bad))]" : "bg-primary",
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {typeof body === "string" ? (
        <p className="text-sm text-muted-foreground">{body}</p>
      ) : (
        body
      )}
    </Dialog>
  );
}
