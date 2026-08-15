/**
 * The LIVE/TEST control below `sm`, and the confirmation both directions go
 * through.
 *
 * WHY THIS EXISTS AT ALL — THE CONTROL WAS ASYMMETRIC, NOT MISSING. `EnvToggle`
 * in app-shell.tsx is `hidden … sm:inline-flex`, so under 640px it does not
 * render. The sandbox banner DOES render there, and it carries a "Switch to
 * live" button. Net effect: a phone user in TEST could get out, and a phone
 * user in LIVE could never get in. That is a one-way door, not a missing icon,
 * which is why the fix is a control rather than a breakpoint change.
 *
 * WHY A CHIP AND NOT THE SEGMENTED CONTROL, SHRUNK. Two cells plus their border
 * is ~100px of a 360px strip that already carries a hamburger, the app mark,
 * search, a bell and an avatar — and half that width is spent naming the
 * environment you are NOT in. On a phone the question the strip has to answer
 * at a glance is "which am I in?"; "how do I change it?" can afford one more
 * tap. So the chip states the current env and opens a sheet.
 *
 * WHY CONFIRMATION HERE AND NOT ON DESKTOP. The desktop control names both
 * targets, sits under a pointer, and a mis-click is a click. The chip is a
 * thumb-sized target on a strip the thumb crosses on its way to the bell, and
 * the cost of a stray switch is somebody writing real records believing they
 * are sandboxed — or filing sandbox records as the real ones. Both directions
 * ask, because both directions are wrong to get wrong. The `sm:`-and-up
 * segmented control keeps its single-tap behaviour untouched.
 *
 * NOTHING HERE TOUCHES `switchEnv`. It is handed in as `onSwitch` and called
 * exactly once, after a confirmation resolves. Its internal ordering
 * (cancelQueries → disconnectCommsSocket → setEnv) is the documented fix for
 * the stale-toggle bug; this module changes WHO calls it and WHEN, never what
 * it does.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { CheckIcon } from "@/components/ui/icons";

export type Env = "live" | "sandbox";

/** The env is a plain string in `tokenStore` and in shell state, and anything
 *  that is not the sandbox is live — the same reading `EnvToggle` and
 *  `EnvSwitchOverlay` already do inline (`env !== "sandbox"`). */
const asEnv = (env: string): Env => (env === "sandbox" ? "sandbox" : "live");

const LABEL: Record<Env, string> = { live: "LIVE", sandbox: "TEST" };

/**
 * The two tints, and the ONLY place this module names a colour.
 *
 * These are the exact pairings `EnvToggle` and `EnvSwitchOverlay` use — `--ok`
 * over `--ok-fill / 0.14`, `--warn` over `--warn-fill / 0.16` — not an
 * approximation of them. Raw `emerald-*` / `amber-*` would look close in light
 * mode and wrong in dark, where both tokens are redefined; two of the palette
 * bypasses audit F14 counted were in this very control.
 */
const TINT: Record<Env, string> = {
  live: "bg-[rgb(var(--ok-fill)_/_0.14)] text-[rgb(var(--ok))]",
  sandbox: "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]",
};

const ROW: Record<Env, { title: string; hint: string }> = {
  live: { title: "Live", hint: "Real data. Changes are permanent." },
  sandbox: { title: "Test", hint: "Sandbox data. Changes don't affect live." },
};

/**
 * The confirmation copy, keyed by DESTINATION.
 *
 * `confirmLabel` names the environment you are going to, per `ConfirmDialog`'s
 * own guidance: a Yes/No pair makes the user re-read the title to find out what
 * they are agreeing to, and this is a dialog people will meet often enough to
 * start dismissing on muscle memory.
 */
const CONFIRM: Record<Env, { title: string; body: string; confirmLabel: string }> = {
  sandbox: {
    title: "Switch to TEST mode?",
    body: "You'll be viewing sandbox data. Changes you make in TEST don't affect live records.",
    confirmLabel: "Switch to TEST",
  },
  live: {
    title: "Switch to LIVE mode?",
    body: "You'll be working with real data. Changes you make here are permanent.",
    confirmLabel: "Switch to LIVE",
  },
};

/**
 * "Are you sure" for an env change, in either direction.
 *
 * NEITHER DIRECTION IS `destructive`. `--bad` is the deletion colour, and a red
 * confirm here would say the wrong thing twice: going to TEST is the SAFE
 * direction (it is the sandbox), and going to LIVE is normal working state, not
 * a deletion. The warn/ok tints on the chip and the row already carry which
 * environment is which; the dialog only has to make the change deliberate.
 */
function EnvConfirm({
  to,
  onCancel,
  onConfirm,
}: {
  to: Env | null;
  onCancel: () => void;
  onConfirm: (to: Env) => void;
}) {
  // `?? "live"` supplies copy for the closing frame only — the dialog is
  // `open={!!to}`, so no user ever sees strings chosen by that fallback.
  const copy = CONFIRM[to ?? "live"];
  return (
    <ConfirmDialog
      open={!!to}
      onClose={onCancel}
      onConfirm={() => to && onConfirm(to)}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      cancelLabel="Cancel"
    />
  );
}

/**
 * The status chip and the sheet it opens. `sm:hidden` — above that width the
 * segmented `EnvToggle` in app-shell.tsx is the control, unchanged.
 */
export function EnvChip({ env, onSwitch }: { env: string; onSwitch: (next: Env) => void }) {
  const current = asEnv(env);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [queued, setQueued] = React.useState<Env | null>(null);
  const [confirming, setConfirming] = React.useState<Env | null>(null);

  /**
   * THE SHEET CLOSES BEFORE THE CONFIRM OPENS — never alongside it.
   *
   * Two reasons, both of which `Dialog` documents about itself. Stacked dialogs
   * mean two focus traps arguing over the document. And `Dialog` restores focus
   * to whatever was focused when it opened: letting the sheet finish first
   * hands focus back to the chip, so the CHIP is what the confirm captures as
   * its opener — which is why cancelling lands back on the chip with no bespoke
   * `focus()` call anywhere in this file. A zero-delay timeout, because "after
   * the close has settled" is a frame boundary, not a duration.
   */
  React.useEffect(() => {
    if (!queued) return;
    const t = window.setTimeout(() => {
      setConfirming(queued);
      setQueued(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [queued]);

  function choose(next: Env) {
    setSheetOpen(false);
    // Mirrors `switchEnv`'s own `if (next === env) return`. Picking the row you
    // are already on is not a change, so it does not get a confirmation asking
    // you to agree to one — it just closes.
    if (next === current) return;
    setQueued(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        // Not `aria-label="LIVE"`. A lone value on a button says what the
        // button reads, not what pressing it does — so the name carries the
        // current environment AND the affordance.
        aria-label={`Data environment: ${LABEL[current]}. Change environment.`}
        className={cn(
          // `wco-touch` (index.css) is the strip's touch height: 40px, or the
          // strip's own height where that is shorter, so a compact-density bar
          // is not pushed taller by its own controls.
          "wco-touch flex min-w-[56px] items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold sm:hidden",
          TINT[current],
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        {LABEL[current]}
      </button>

      {/* `Dialog`, not a hand-rolled panel — focus trap, Escape, scroll lock,
          `aria-labelledby` and opener-focus restoration are exactly what a
          bespoke sheet gets wrong, and it is already a bottom sheet at this
          width. Same reasoning `FamilySheet` in mobile-nav.tsx records. */}
      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Data environment">
        <div className="flex flex-col gap-2">
          {(["live", "sandbox"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => choose(e)}
              // `aria-current`, not `aria-checked`. These rows are commands that
              // open a confirmation, so nothing is selected at the moment one is
              // pressed — announcing "checked" for a change that has not
              // happened yet would be a lie the user then has to disprove.
              aria-current={e === current ? "true" : undefined}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/50"
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold", TINT[e])}>
                {LABEL[e]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{ROW[e].title}</span>
                <span className="block text-xs text-muted-foreground">{ROW[e].hint}</span>
              </span>
              {/* `-ink`, not `text-primary`. `--primary` is a FILL — it measures
                  2.59:1 as type on `--card` (audit F13), and the tick is type
                  here, drawn in stroke at 18px. The ink variant is
                  token-for-token the same brand colour at a legible value, and
                  `scripts/check-contrast.mjs` fails the build on the other
                  spelling precisely because it is the shorter one to type. */}
              {e === current && <CheckIcon aria-hidden className="shrink-0 text-primary-ink" />}
            </button>
          ))}
        </div>
      </Dialog>

      <EnvConfirm
        to={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(to) => {
          setConfirming(null);
          onSwitch(to);
        }}
      />
    </>
  );
}

/**
 * The sandbox banner's way out.
 *
 * It used to call `switchEnv("live")` straight from an onClick, which meant a
 * phone had two ways to change environment and only one of them asked. Same
 * `EnvConfirm`, same copy, same single call to `switchEnv` — so "changing
 * environment always confirms" is a property of the app, not of one control.
 *
 * It is NOT width-gated, because the banner is not: a desktop user in TEST sees
 * this button too, and the exception carved out for desktop is the segmented
 * toggle's single tap, not this.
 */
export function SwitchToLiveButton({ onSwitch }: { onSwitch: (next: Env) => void }) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="ml-1 underline underline-offset-2 hover:no-underline"
      >
        Switch to live
      </button>
      <EnvConfirm
        to={confirming ? "live" : null}
        onCancel={() => setConfirming(false)}
        onConfirm={(to) => {
          setConfirming(false);
          onSwitch(to);
        }}
      />
    </>
  );
}
