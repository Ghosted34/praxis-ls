/**
 * The LIVE/TEST controls, the confirmation every change of environment goes
 * through, and the interstitial shown while Praxis reloads into the other one.
 *
 * ── ONE FLOW, EVERY WIDTH ──────────────────────────────────────────────────
 *
 * There used to be two behaviours. The phone's chip asked before switching;
 * the desktop's segmented control switched on a single unconfirmed click, and
 * the asymmetry was argued from pointer precision. That argument missed what
 * the switch actually costs: not the click, but everything in flight when it
 * lands — a half-written task, a filter someone spent a minute building, a
 * draft reply. A switch now RELOADS the page (see `switchEnv` in
 * app-shell.tsx for why), which makes that cost total and makes "are you
 * sure" the wrong question. The right one is "have you saved?", asked the
 * same way on a thumb and under a pointer:
 *
 *   control (chip / segment / banner link)
 *     → `EnvSwitchDialog`   current → destination, the unsaved-work warning,
 *                           "Stay in LIVE" / "Switch to TEST"
 *     → `onSwitch(to)`      called exactly once, after the confirmation
 *     → `EnvSwitchOverlay`  full-screen while the reload is in progress
 *
 * `onSwitch` is `switchEnv` handed in from the shell. Nothing in this file
 * decides what a switch DOES; it decides who may ask for one and what they are
 * told first.
 *
 * ── WHY THE PHONE LOST ITS SHEET ───────────────────────────────────────────
 *
 * The chip used to open a two-row sheet ("Live" / "Test") and THEN a confirm.
 * With exactly two environments the sheet only ever offered the one you are
 * not in, so it was a tap that carried no decision. The dialog shows both
 * environments side by side — which one you are in, which one you are going
 * to — so the information the sheet carried is still on screen, one tap
 * earlier, and identical to what the desktop control shows.
 *
 * ── COLOUR ────────────────────────────────────────────────────────────────
 *
 * `--ok` over `--ok-fill` for LIVE and `--warn` over `--warn-fill` for TEST,
 * the exact pairings the toggle has always used and the only two this file
 * names. Raw `emerald-*` / `amber-*` would look close in light mode and wrong
 * in dark, where both tokens are redefined; two of the palette bypasses audit
 * F14 counted were in this very control. The primary button stays the brand
 * button: white type on the amber fill measures under AA in dark mode, and a
 * confirm you cannot read is not a confirm.
 *
 * ── MOTION ────────────────────────────────────────────────────────────────
 *
 * Every animation here is declared in tailwind.config.ts and lands inside the
 * 250 ms budget `scripts/check-motion.mjs` holds; the only loop is the
 * overlay's spinner, which is the framework spinner the gate already exempts
 * because it lasts exactly as long as the wait. The staggered delays on the
 * dialog's rows are inline and short (≤ 200 ms) so the whole entrance is over
 * before a hand has moved to the button. The global reduced-motion kill in
 * index.css reaches all of it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  RefreshIcon,
} from "@/components/ui/icons";

export type Env = "live" | "sandbox";

/** The env is a plain string in `tokenStore` and in shell state, and anything
 *  that is not the sandbox is live — the same reading the toggle has always
 *  done inline (`env !== "sandbox"`). */
export const asEnv = (env: string): Env => (env === "sandbox" ? "sandbox" : "live");

/** The other one. Two environments, so "switch" has exactly one destination. */
export const otherEnv = (env: Env): Env => (env === "sandbox" ? "live" : "sandbox");

export const ENV_LABEL: Record<Env, string> = { live: "LIVE", sandbox: "TEST" };

/**
 * The two tints, and the ONLY place this module names a colour (see header).
 * `badge` is the solid chip, `surface` the card wash behind a destination.
 */
const TINT: Record<Env, { badge: string; surface: string; ring: string; dot: string }> = {
  live: {
    badge: "bg-[rgb(var(--ok-fill)_/_0.14)] text-[rgb(var(--ok))]",
    surface: "border-[rgb(var(--ok-fill)_/_0.45)] bg-[rgb(var(--ok-fill)_/_0.08)]",
    ring: "border-t-[rgb(var(--ok))]",
    dot: "bg-[rgb(var(--ok))]",
  },
  sandbox: {
    badge: "bg-[rgb(var(--warn-fill)_/_0.16)] text-[rgb(var(--warn))]",
    surface: "border-[rgb(var(--warn-fill)_/_0.5)] bg-[rgb(var(--warn-fill)_/_0.1)]",
    ring: "border-t-[rgb(var(--warn))]",
    dot: "bg-[rgb(var(--warn))]",
  },
};

/** The solid LIVE / TEST chip, sized for a card (`md`) or a strip (`sm`). */
function EnvBadge({ env, size = "md", className }: { env: Env; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md font-bold tracking-wide",
        size === "lg" && "px-3 py-1.5 text-base",
        size === "md" && "px-2 py-0.5 text-xs",
        size === "sm" && "px-1.5 py-0.5 text-[11px]",
        TINT[env].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TINT[env].dot)} />
      {ENV_LABEL[env]}
    </span>
  );
}

/**
 * One side of the journey strip: where you are, or where you are going. The
 * destination is the emphasised one — tinted surface, slides in from the
 * right a beat after the current card has settled — because the destination is
 * the fact the reader must not get wrong.
 */
function EnvCard({ env, role, delay }: { env: Env; role: "current" | "destination"; delay: number }) {
  const { t } = useTranslation();
  const destination = role === "destination";
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border p-3",
        destination ? cn("animate-slide-in-right", TINT[env].surface) : "animate-rise-in bg-card",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {destination ? t("shell.envYouWillBeIn") : t("shell.envYouAreIn")}
      </span>
      <EnvBadge env={env} size="md" />
      <span className="text-xs leading-snug text-muted-foreground">
        {env === "sandbox" ? t("shell.envSandboxHint") : t("shell.envLiveHint")}
      </span>
    </div>
  );
}

/**
 * The confirmation, in either direction.
 *
 * Its job is not "are you sure" — it is to make the one consequence of the
 * reload unmissable BEFORE the answer: unsaved work does not survive it. So the
 * warning is the loudest element after the title, the buttons name the two
 * outcomes in full ("Stay in LIVE" / "Switch to TEST") rather than Yes/No, and
 * the journey strip states both environments so nobody has to remember which
 * one they were in.
 *
 * NEITHER DIRECTION IS `bad`. `--bad` is the deletion colour, and a red confirm
 * here would say the wrong thing twice: going to TEST is the SAFE direction (it
 * is the sandbox), and going to LIVE is normal working state, not a deletion.
 * The header carries the DESTINATION's tint instead, so the whole surface says
 * where you are going.
 *
 * `open` is derived from `to`: a null destination is the closing frame, and
 * the copy for that frame comes from the fallback nobody sees.
 */
export function EnvSwitchDialog({
  from,
  to,
  onCancel,
  onConfirm,
}: {
  from: Env;
  to: Env | null;
  onCancel: () => void;
  onConfirm: (to: Env) => void;
}) {
  const { t } = useTranslation();
  const dest = to ?? otherEnv(from);
  const destLabel = ENV_LABEL[dest];
  const fromLabel = ENV_LABEL[from];
  return (
    <Dialog
      open={!!to}
      onClose={onCancel}
      title={t(dest === "sandbox" ? "shell.envSwitchToTestTitle" : "shell.envSwitchToLiveTitle")}
      description={t("shell.envReloadNote", { env: destLabel })}
      accent={dest === "sandbox" ? "warn" : "ok"}
      titleIcon={
        <span
          aria-hidden
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            dest === "sandbox" ? "bg-warn-fill/12 text-warn" : "bg-ok-fill/12 text-ok",
          )}
        >
          <RefreshIcon width={18} height={18} />
        </span>
      }
      footer={
        <>
          <Button type="button" variant="outline" size="sm" icon={null} onClick={onCancel}>
            {t("shell.envStayIn", { env: fromLabel })}
          </Button>
          <Button
            type="button"
            size="sm"
            icon={<ArrowRightIcon width={16} height={16} aria-hidden />}
            onClick={() => to && onConfirm(to)}
          >
            {t("shell.envSwitchTo", { env: destLabel })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The journey: current → destination. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
          <EnvCard env={from} role="current" delay={0} />
          <div aria-hidden className="flex items-center text-muted-foreground">
            <ArrowRightIcon
              width={20}
              height={20}
              className="animate-pop-in"
              style={{ animationDelay: "120ms" }}
            />
          </div>
          <EnvCard env={dest} role="destination" delay={80} />
        </div>

        {/* THE warning. `role="note"` rather than `alert`: it is read in the
            flow of the dialog, not barked over it. */}
        <div
          role="note"
          style={{ animationDelay: "160ms" }}
          className="flex gap-3 rounded-lg border border-warn-fill/40 bg-warn-fill/10 px-3 py-2.5 animate-rise-in"
        >
          <AlertTriangleIcon width={18} height={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">{t("shell.envUnsavedTitle")}</p>
            <p className="mt-0.5 text-muted-foreground">{t("shell.envUnsavedBody")}</p>
          </div>
        </div>

        <ul
          style={{ animationDelay: "200ms" }}
          className="grid gap-1.5 text-xs text-muted-foreground animate-rise-in sm:grid-cols-2"
        >
          <li className="flex items-center gap-1.5">
            <CheckIcon width={14} height={14} className="shrink-0 text-ok" aria-hidden />
            {t("shell.envStaySignedIn")}
          </li>
          <li className="flex items-center gap-1.5">
            <CheckIcon width={14} height={14} className="shrink-0 text-ok" aria-hidden />
            {t("shell.envSamePage", { env: destLabel })}
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

/**
 * LIVE / TEST, from `sm` up. Two labelled cells; the one you are in is
 * pressed. Pressing the other opens `EnvSwitchDialog` — the same dialog the
 * phone's chip and the banner open — and nothing changes until it is answered.
 */
export function EnvToggle({
  env,
  onSwitch,
}: {
  env: string;
  onSwitch: (next: Env) => void;
}) {
  const current = asEnv(env);
  const [confirming, setConfirming] = React.useState<Env | null>(null);
  const cell = (e: Env) => (
    <button
      key={e}
      type="button"
      onClick={() => e !== current && setConfirming(e)}
      aria-pressed={e === current}
      aria-haspopup={e === current ? undefined : "dialog"}
      className={cn(
        "rounded-sm px-2 py-1 transition-colors",
        e === current ? TINT[e].badge : "text-muted-foreground hover:text-foreground",
      )}
    >
      {ENV_LABEL[e]}
    </button>
  );
  return (
    <>
      <div
        className="hidden items-center rounded-md border p-0.5 text-[11px] font-semibold sm:inline-flex"
        role="group"
        aria-label="Data environment"
      >
        {cell("live")}
        {cell("sandbox")}
      </div>
      <EnvSwitchDialog
        from={current}
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
 * The status chip below `sm`. Two labelled cells cost ~100px of a 360px strip
 * that already carries a hamburger, the app mark, search, a bell and an
 * avatar — so the chip states the environment you are IN and opens the switch
 * dialog for the other one.
 */
export function EnvChip({
  env,
  onSwitch,
}: {
  env: string;
  onSwitch: (next: Env) => void;
}) {
  const current = asEnv(env);
  const [confirming, setConfirming] = React.useState<Env | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(otherEnv(current))}
        aria-haspopup="dialog"
        aria-expanded={!!confirming}
        // Not `aria-label="LIVE"`. A lone value on a button says what the
        // button reads, not what pressing it does — so the name carries the
        // current environment AND the affordance.
        aria-label={`Data environment: ${ENV_LABEL[current]}. Change environment.`}
        className={cn(
          // `wco-touch` (index.css) is the strip's touch height: 40px, or the
          // strip's own height where that is shorter, so a compact-density bar
          // is not pushed taller by its own controls.
          "wco-touch flex min-w-[56px] items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold sm:hidden",
          TINT[current].badge,
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        {ENV_LABEL[current]}
      </button>
      <EnvSwitchDialog
        from={current}
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
 * The sandbox banner's way out. Same dialog, same single call to `onSwitch`,
 * so "changing environment always asks first" is a property of the app, not of
 * one control. Not width-gated, because the banner is not.
 */
export function SwitchToLiveButton({
  onSwitch,
}: {
  onSwitch: (next: Env) => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-haspopup="dialog"
        className="ml-1 underline underline-offset-2 hover:no-underline"
      >
        Switch to live
      </button>
      <EnvSwitchDialog
        from="sandbox"
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

/** How long the overlay waits before it offers to reload by hand (ms). */
export const ENV_RELOAD_STUCK_MS = 5000;

/**
 * Full-screen interstitial while the reload is in progress.
 *
 * Shown from the moment the switch is confirmed until the browser replaces
 * the document. It covers the OLD environment's screen — chrome, banner, data —
 * so nothing from it can be read or clicked as though it belonged to the new
 * one, and it tells the reader what is happening in the terms they chose.
 *
 * `role="status"` + `aria-live="polite"` so screen-reader users hear the
 * change instead of losing focus to a reload with no announcement of why.
 *
 * THE ESCAPE HATCH. A reload can be refused: a screen with unsaved work may
 * hold a `beforeunload` guard and the browser then asks its own question, and
 * "stay" leaves this overlay up over a page that is going nowhere. After
 * `ENV_RELOAD_STUCK_MS` the overlay offers the reload again by hand. That is
 * safe on a slow connection too — a second reload request replaces the first —
 * whereas silently undoing the switch would be wrong: the new environment is
 * already persisted and a document already on its way would boot into it.
 */
export function EnvSwitchOverlay({ to, onReload }: { to: Env; onReload: () => void }) {
  const { t } = useTranslation();
  const [stuck, setStuck] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setStuck(true), ENV_RELOAD_STUCK_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("shell.envSwitchRegion")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm animate-fade-in"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-6 text-center shadow-[var(--shadow-l)] animate-pop-in">
        <span className="relative grid h-16 w-16 place-items-center">
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 rounded-full border-2 border-border/60 animate-spin",
              TINT[to].ring,
            )}
          />
          <EnvBadge env={to} size="sm" />
        </span>
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t("shell.envSwitching", { env: ENV_LABEL[to] })}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t("shell.envLoadingFresh")}</div>
        </div>
        <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full w-full origin-left animate-grow-x", TINT[to].dot)} />
        </span>
        {stuck && (
          <Button type="button" variant="outline" size="sm" icon={null} onClick={onReload} className="animate-rise-in">
            {t("shell.envReloadNow")}
          </Button>
        )}
      </div>
    </div>
  );
}
