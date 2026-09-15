/**
 * useConfirm — `await confirm({…})` with a branded dialog behind it.
 *
 * WHY A HOOK AND NOT JUST <ConfirmDialog>. `<ConfirmDialog>` is the right
 * primitive when a screen has ONE confirmation and a natural place to keep its
 * state. Most of the sites this replaces are not that shape:
 *
 *   comms/inbox/index.tsx      three separate destructive verbs in one screen
 *   hr/vacancy.tsx             a confirm inside a longer async flow
 *   settings/scheduled-reports a confirm inside a per-row callback
 *
 * Converting those to `useState` + JSX means hoisting the row/argument into
 * state, splitting one async function into a "start" half and a "finish" half,
 * and re-threading the busy flag through both. Done fourteen times that is a
 * lot of restructuring for a change that is supposed to be about appearance —
 * and every restructured async flow is a chance to introduce a bug that the
 * original `window.confirm` did not have.
 *
 * So this keeps the CALL SHAPE that made `window.confirm` convenient:
 *
 *     const [confirm, confirmDialog] = useConfirm();
 *
 *     async function remove(row) {
 *       if (!(await confirm({
 *         title: "Delete this rate card?",
 *         body: `"${row.name}" stops applying to new quotations.`,
 *         confirmLabel: "Delete rate card",
 *         destructive: true,
 *       }))) return;
 *       … unchanged …
 *     }
 *
 *     return <>{confirmDialog} … </>;
 *
 * The diff at each call site is then the same three lines it was before, and the
 * async flow underneath is untouched. What changes is what the person sees.
 *
 * HOW IT RESOLVES. Opening stores the promise's `resolve` in a ref; the footer
 * buttons call it with true/false and close. Dismissal — Escape, the close
 * button, the backdrop where allowed — resolves FALSE, never leaves the promise
 * hanging: an unresolved confirm would strand the `await` and silently disable
 * whatever action it guarded, which is a worse failure than the dialog looking
 * wrong.
 *
 * DEFAULTS ARE DELIBERATE. `destructive` defaults to false, but `dismissible`
 * defaults to FALSE for destructive confirms — the one property `window.confirm`
 * had that a normal modal does not is that clicking away is not an answer, and
 * for "delete for ever" that property is the point. Non-destructive confirms
 * stay dismissible.
 *
 * UNMOUNTING. If the host unmounts while a confirm is open the pending promise
 * is resolved false on cleanup, so an `await` in a detached async function
 * cannot hang forever.
 */
import * as React from "react";
import { ConfirmDialog } from "@/components/ui/dialog";

export type ConfirmOptions = {
  /** Names the OUTCOME, as a question: "Delete this conversation for ever?" */
  title: string;
  /** The consequences. A string, or JSX when the detail deserves structure. */
  body?: React.ReactNode;
  /** Names the ACTION: "Delete conversation", never "OK". */
  confirmLabel?: string;
  /** Names the way out: "Keep it", "Cancel". */
  cancelLabel?: string;
  /** Warning red, warning glyph, tinted header. Use for anything irreversible. */
  destructive?: boolean;
  /**
   * Clicking away / Escape answers "no" rather than being ignored.
   * Defaults to `!destructive` — see the header.
   */
  dismissible?: boolean;
};

type State = (ConfirmOptions & { open: boolean }) | null;

export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [state, setState] = React.useState<State>(null);
  const resolver = React.useRef<((ok: boolean) => void) | null>(null);

  // A pending confirm must never outlive the component that asked it.
  React.useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const confirm = React.useCallback((options: ConfirmOptions) => {
    // A second confirm while one is open would orphan the first promise.
    // Resolving it false is the honest answer: it was never agreed to.
    resolver.current?.(false);
    setState({ ...options, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    // Keep the content mounted through the close so the dialog animates out
    // with its text intact rather than emptying first.
    setState((s) => (s ? { ...s, open: false } : null));
  }, []);

  const dialog = state ? (
    <ConfirmDialog
      open={state.open}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={state.title}
      body={state.body}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      dismissible={state.dismissible ?? !state.destructive}
    />
  ) : null;

  return [confirm, dialog];
}
