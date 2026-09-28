/**
 * RecordSheet — a list's open record, full screen, on a phone.
 *
 * WHY A SHEET AND NOT THE STACK. Below `lg`, a `<SplitPane>` used to stack its
 * detail pane UNDER the list. Opening a client meant tapping a row and then
 * scrolling past every other client to reach the one you had opened — and
 * back up again to open the next. The record was a destination you had to
 * travel to, on the screen size where travel is most expensive. A sheet puts
 * the record in front of the list, at full height, and takes it away again.
 *
 * FULL SCREEN, NOT THE 92% BOTTOM SHEET `<Dialog>` IS ON A PHONE. A 360 is a
 * headline band, a sticky section strip and tables; the strip of dimmed list
 * above a bottom sheet is space it needs, and a sheet that can be flung down
 * fights the dossier's own vertical scroll for the same gesture. The ✕ is top
 * RIGHT, where a phone's own full-screen views put it.
 *
 * CLOSING RETURNS YOU EXACTLY WHERE YOU WERE. Three things make that true, and
 * each is load-bearing:
 *
 *   - the list is never unmounted — the sheet is an overlay, so the shell's
 *     scroll position, the list's own scroll and any search you typed are all
 *     still there underneath;
 *   - focus goes back to the row you opened, with `preventScroll` — a plain
 *     `focus()` scrolls a half-visible row into view, which is a jump;
 *   - Back closes it. Opening the sheet is a step in the history, so the
 *     phone's Back gesture — the most-used control on the device — undoes the
 *     sheet rather than leaving the screen. A screen whose selection already
 *     lives in the URL (`useRecordParam`'s `?focus=`) has that step already and
 *     passes `ownsHistory={false}`; any other screen gets one from the sheet
 *     itself (`?sheet=1`, see `useSheetStep`).
 *
 * @example
 * <RecordSheet open={!!selected} onClose={() => setSelId(null)}
 *              eyebrow={tr("Supplier")} title={selected?.name ?? tr("Supplier")}>
 *   <PartyDossier … />
 * </RecordSheet>
 *
 * `<SplitPane onClose>` renders this for you below `lg` — reach for it
 * directly only for a list that is not a split pane.
 */
import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { XIcon } from "@/components/ui/icons";
import { tr } from "@/lib/i18n";

/** The history step a sheet adds for itself when the page's selection is not
 *  in the URL. Exported so a screen can recognise it rather than parse it as
 *  one of its own filters. */
export const SHEET_PARAM = "sheet";

type Phase = "idle" | "pushing" | "pushed";

/**
 * Make an open sheet a step the Back gesture can undo.
 *
 * Returns the close action for the ✕: when the sheet added its own step, the
 * ✕ steps BACK over it (so Forward does not reopen a sheet over an empty
 * selection and the stack does not grow a step per record viewed); the step
 * disappearing is what closes the sheet, the same path Back takes.
 *
 * A PHASE, NOT A FLAG, because the app runs under StrictMode. A boolean
 * "pushed" set before the URL has caught up reads, on the effect's second
 * dev-mode run, exactly like "the user pressed Back" — the sheet opened and
 * closed itself in one frame. `pushing` is the state in between, and it waits.
 */
function useSheetStep(open: boolean, onClose: () => void, enabled: boolean) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const marked = params.get(SHEET_PARAM) === "1";
  const phase = React.useRef<Phase>("idle");
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!enabled) return;

    if (open && !marked) {
      if (phase.current === "idle") {
        // Opened: add the step Back will undo.
        phase.current = "pushing";
        setParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set(SHEET_PARAM, "1");
          return next;
        });
      } else if (phase.current === "pushed") {
        // Our step is gone while the sheet is still open: Back, or the ✕
        // stepping back. Either way the sheet goes with it.
        phase.current = "idle";
        onCloseRef.current();
      }
      // "pushing": the URL has not caught up with our own push yet — wait.
      return;
    }

    if (open && marked) {
      phase.current = "pushed";
      return;
    }

    if (!open && marked) {
      if (phase.current === "pushed" || phase.current === "pushing") {
        // The step on top is ours and the sheet is gone: the PAGE closed the
        // record (it was deleted, or a save moved the selection), or the ✕
        // was quicker than our own push reached the URL. Take the step back
        // off the stack either way, or Back would land on a sheet with
        // nothing in it.
        phase.current = "idle";
        navigate(-1);
      } else {
        // A step this page did not push — a reload with `?sheet=1` in the
        // address, or Back into a list whose selection did not survive. There
        // is no sheet to show, so the marker goes, quietly.
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete(SHEET_PARAM);
            return next;
          },
          { replace: true },
        );
      }
      return;
    }

    // Closed, and no step of ours in the URL. A push still in flight keeps
    // its phase, so the branch above takes it back the moment it lands —
    // resetting here would read that landing as a stale step and leave a
    // duplicate list entry behind.
    if (phase.current !== "pushing") phase.current = "idle";
  }, [enabled, open, marked, navigate, setParams]);

  return React.useCallback(() => {
    if (enabled && phase.current === "pushed" && marked) navigate(-1);
    else onCloseRef.current();
  }, [enabled, marked, navigate]);
}

export function RecordSheet({
  open,
  onClose,
  title,
  eyebrow,
  ownsHistory = true,
  children,
}: {
  open: boolean;
  /** Deselect the record. The sheet calls it on ✕, on Back and on Escape. */
  onClose: () => void;
  /** The open record's name — the sheet's accessible name and its header. */
  title: string;
  /** The KIND of record, already translated ("Supplier"). Optional. */
  eyebrow?: string;
  /**
   * Whether the sheet adds its own history step. Pass `false` when the
   * selection is already a URL parameter (`useRecordParam`) — that is already
   * the step, and a second one would make Back take two presses.
   */
  ownsHistory?: boolean;
  children: React.ReactNode;
}) {
  const requestClose = useSheetStep(open, onClose, ownsHistory);

  // The row that opened the sheet, captured before Radix moves focus inside.
  // Same reasoning as `<Dialog>`: there is no Trigger to return focus to.
  const openerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) openerRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Content
          aria-modal="true"
          // No Description: the header says what this is, and the body is the
          // record itself. Stated so Radix does not warn about a missing one.
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const opener = openerRef.current;
            // `preventScroll`: closing must leave the list exactly where it
            // was. A plain focus() scrolls a half-visible row into view.
            if (opener?.isConnected) opener.focus({ preventScroll: true });
          }}
          // z-50, the same layer as <Dialog>: a form opened from inside the
          // record (Edit, Set rate) is portalled later and must land ON TOP of
          // the sheet, which a higher layer here would prevent. The bottom nav
          // (z-30) and the quick-actions cluster (z-50, portalled earlier) sit
          // underneath.
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] animate-sheet-in"
        >
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b bg-card py-2 pl-4 pr-2">
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <p className="micro flex items-center gap-1.5 text-primary-ink">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  />
                  {eyebrow}
                </p>
              )}
              <RadixDialog.Title className="truncate text-base font-semibold text-foreground">
                {title}
              </RadixDialog.Title>
            </div>
            {/* 44px: the smallest target a thumb hits reliably, and this is
                the control a phone user reaches for most on this screen. */}
            <RadixDialog.Close
              aria-label={tr("Close")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon width={20} height={20} />
            </RadixDialog.Close>
          </header>

          {/*
            The sheet's own scroll container. The record's content is its
            DIRECT in-flow child, so this element's bottom padding is honoured
            at the end of a long dossier — the shell's <main> lost exactly that
            (see the end spacer in app-shell.tsx). The safe-area inset keeps the
            last row above a phone's gesture bar. `overscroll-y-contain` so a
            fling at the end does not chain into the list underneath.
          */}
          <div
            data-record-sheet-body
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4"
          >
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
