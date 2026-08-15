/**
 * FormButtons — the Cancel / Save pair that closes every write form.
 *
 * Consolidates SEVEN byte-identical copies (F6 — the audit counted three;
 * reading found seven): `costing/pages.tsx:28`, `finance/receivables.tsx:32`,
 * `finance/chart-of-accounts.tsx:26`, `finance/debt.tsx:26`,
 * `procurement/pages.tsx:37`, `operations/pages.tsx:57`,
 * `masterdata/pages.tsx:26`.
 *
 * The behaviour worth having in one place is the disabled logic, which every
 * copy got right and which is easy to get wrong: Cancel is disabled while a
 * save is in flight (so a half-committed write cannot be abandoned), Save is
 * disabled on invalid input but NOT while busy — `loading` already blocks it
 * and keeps the spinner visible.
 *
 * @example
 * <form onSubmit={submit}>
 *   <Field label="Name" required><Input … /></Field>
 *   <FormButtons busy={saving} disabled={!canSubmit} onCancel={onClose} saveLabel="Create client" />
 * </form>
 *
 * BEST PRACTICE. Name the action, not the mechanism — "Create client" or "Post
 * entry" beats "Save", and is what the user reads back when confirming an
 * irreversible OHADA posting. Render inside the `<form>` so `type="submit"`
 * carries Enter-to-submit; if the form lives in a `<Modal>` footer instead,
 * pass `form="<id>"` on the submit button rather than moving it out.
 */
import { Button } from "@/components/ui/button";

export function FormButtons({
  busy,
  disabled,
  onCancel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
}: {
  /** A save is in flight: shows the spinner and locks Cancel. */
  busy: boolean;
  /** The form is not valid enough to submit. */
  disabled?: boolean;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={busy}
      >
        {cancelLabel}
      </Button>
      <Button type="submit" loading={busy} disabled={disabled}>
        {saveLabel}
      </Button>
    </div>
  );
}
