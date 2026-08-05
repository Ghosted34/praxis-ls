/**
 * InlineEdit — change one field without opening a form (Phase 5, audit F9).
 *
 * WHY. Renaming a service type today costs a modal with six fields, a Save and a
 * reload, to change one word. Multiply that by the label, code and description
 * fields scattered across the master-data screens and it is the most common
 * interaction in the product wearing the heaviest control the product has.
 *
 * WHERE IT DOES NOT FIT, which matters more than where it does. **Never on a
 * field that participates in a posted document.** This ledger's rule is
 * reversal-not-edit: a validated journal entry, a locked FINAL invoice and a
 * posted payroll run are immutable by design, and the correction path is a
 * contra entry with its own audit trail. An inline pencil on any of those would
 * be a control that offers something the backend will refuse — or worse, one
 * that succeeds and quietly breaks the audit chain. Inline edit belongs on
 * descriptive master data: names, labels, notes, references that nothing has
 * been posted against.
 *
 * WHAT IT COMMITS ON, and why blur counts. Enter commits, Escape reverts, and
 * blur commits — which is the behaviour of every inline edit users have met
 * (Airtable, Notion, Linear, a spreadsheet). Treating blur as a cancel is the
 * alternative, and it silently discards typing whenever someone clicks away to
 * check something, which is the more expensive mistake of the two. Escape is
 * always available and is the documented way out.
 *
 * WHAT HAPPENS WHEN THE SAVE FAILS. The value reverts to what it was, and the
 * error is reported through the shell's banner. It does NOT stay optimistically
 * changed: a name that reads as saved but is not is exactly how two people end
 * up looking at different values and neither knows.
 *
 * @example
 * <InlineEdit
 *   label="Service name"
 *   value={r.name_en || r.name_fr}
 *   onSave={async (next) => { await api.updateServiceType(r.service_type_id, { name_en: next }); reload(); }}
 * />
 *
 * BEST PRACTICE. `label` is what a screen reader announces in place of a
 * visible one — write it as the field's name ("Service name"), not the action
 * ("Edit"). Set `required` where empty is not a legal value; the control
 * reverts rather than sending it.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/states";
import { PencilIcon } from "@/components/ui/icons";
import { reportActionError } from "@/lib/action-error";

export function InlineEdit({
  value,
  onSave,
  label,
  required,
  placeholder = "—",
  className,
  disabled,
}: {
  value: string;
  /** Rejecting reverts the displayed value and surfaces the message. */
  onSave: (next: string) => Promise<void> | void;
  /** The FIELD's name, e.g. "Service name". Becomes the control's accessible name. */
  label: string;
  /** Empty is not legal — an empty commit reverts instead of saving. */
  required?: boolean;
  /** Shown when the value is empty. Still activatable. */
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  // Escape sets this so the blur that follows does not re-commit the draft the
  // user just abandoned — blur fires after the key handler, every time.
  const cancelled = React.useRef(false);
  // Set when the exit was a KEY, so focus goes back to the button. Not set when
  // the exit was a blur, because then the user is already somewhere else and
  // yanking focus back would be the component fighting them.
  const restore = React.useRef(false);

  // A reload, or another user's change arriving through the query cache, must
  // win over a stale draft that is not being edited.
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  /**
   * Focus has to be MOVED, not merely selected — found by the test, and it was a
   * real defect in both directions. Entering edit mode unmounts the button and
   * mounts the input, so a keyboard user who pressed Enter had focus fall to
   * <body>; leaving it did the same in reverse. `select()` alone does not focus
   * the element (it is a selection API), and the browsers that appear to do so
   * are not required to.
   */
  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restore.current) {
      restore.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === value) return; // nothing changed — no request
    if (required && !next) {
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
    } catch (e) {
      // Revert. An optimistic value that did not save is how two people end up
      // looking at different data and neither of them knows.
      setDraft(value);
      reportActionError(e);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={(e) => {
          // The row this sits in may be inside a table with arrow-key row
          // navigation; stopping propagation keeps text-cursor keys textual.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            restore.current = true;
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelled.current = true;
            restore.current = true;
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn(
          "-mx-1.5 -my-0.5 w-full min-w-0 rounded border border-input bg-background px-1.5 py-0.5 text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      /*
       * `aria-busy` rather than `disabled` while the save is in flight — found
       * by the focus test, and it is not a detail. A `disabled` button cannot
       * hold focus, so the browser blurs it: pressing Enter to commit would
       * unmount the input, land on a disabled button, and drop the keyboard user
       * on <body> for the duration of the request. `aria-busy` announces the
       * same state, keeps the element focusable, and the handler below refuses
       * the click, so the only thing lost is the focus bug.
       */
      aria-busy={busy}
      // The name carries the field AND its current value, so activating it is
      // not a leap of faith: "Service name, Customs clearance, edit".
      aria-label={`${label}${value ? `, ${value}` : ""}, edit`}
      onClick={(e) => {
        // The row underneath may navigate on click; editing a cell must not
        // also open the record.
        e.stopPropagation();
        if (busy) return;
        setEditing(true);
      }}
      className={cn(
        "group -mx-1.5 -my-0.5 inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-sm",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
      {busy ? (
        <Spinner className="h-3 w-3 shrink-0" />
      ) : (
        // Hidden until hover or keyboard focus: an always-on pencil on every
        // editable cell turns a table into a form. It is decoration — the
        // button's accessible name already says "edit".
        <PencilIcon
          aria-hidden
          width={12}
          height={12}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
  );
}
