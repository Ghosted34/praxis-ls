/**
 * Refresh — the third control in the rail's navigation pill, under back and
 * forward.
 *
 * WHY AN INSTALLED APP NEEDS ONE AT ALL. Same reason the arrows above it exist:
 * `display_override: ["window-controls-overlay"]` (src/routes/pwa.js) tells the
 * OS to stop drawing a title bar, and the strip it hands the page has no reload
 * button in it. A dispatcher running Praxis as an app has ⌘R and nothing else —
 * no pointer route to a refresh at all, on the surface where a stale figure
 * costs the most. That was the request, and it is the whole justification for
 * spending a fourth cell of the rail's fixed zone.
 *
 * TWO DIFFERENT VERBS, AND THE DISTINCTION IS THE DESIGN. What a person means
 * by "refresh" in an ERP is almost never "throw the application away and boot
 * it again":
 *
 *   TAP — refetch. Every active query is invalidated and refetched in place.
 *     No white flash, no boot, no lost scroll position, and — the one that
 *     actually matters — no lost form draft, because the page never unloads.
 *     This is the answer to "are these numbers current?", which is the question
 *     being asked ninety-nine times out of a hundred.
 *
 *   HOLD (or right-click) — the menu, which is where the destructive version
 *     lives: `Reload app` throws the tab away and boots, for the hundredth case
 *     where the app itself is wedged rather than the data being old. Putting it
 *     behind a deliberate gesture means the cheap action is the easy one and the
 *     expensive one still exists.
 *
 * The gesture is `use-hold-menu.ts` — the same one back and forward use, for
 * the same reason, so the three cells of this pill behave identically.
 *
 * THE MARK IS A DIAL, NOT A SPINNER. A refresh button that looks identical at
 * two seconds old and at forty minutes old answers "can I press this" and never
 * answers "do I need to". So the ring around the arrowhead is drawn from
 * `lib/data-freshness.ts`: full when the screen's data just landed, eroding
 * anticlockwise as the oldest thing on screen ages, down to a crescent at ten
 * minutes. The arrowhead never leaves, so the glyph still reads as "reload" at
 * every point on that scale — which is the constraint that ruled out the more
 * obvious designs (a ring that fills from empty spends most of its life not
 * looking like a refresh icon).
 *
 * IT DOES NOT CHANGE COLOUR AS IT DRAINS. An amber ring on an idle control says
 * "something is wrong", and nothing is: ten-minute-old data on a costing screen
 * is completely normal. The accent is spent on the two states that really are
 * asking for a decision — a staged build, and a refresh armed while offline.
 *
 * ARMED, NOT FAILED, WHEN OFFLINE. Pressing refresh on a dead connection used
 * to be a request that fails; here it arms instead. The ring goes dashed, and
 * `lib/connection.ts` fires it the moment our own API answers again. A user in
 * a lift presses it once rather than watching for the moment to press it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { navT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
} from "@/components/ui/dropdown-menu";
import { TENANT_KEY } from "@/lib/query-client";
import { getConnection, useRetryOnReconnect } from "@/lib/connection";
import { useDataFreshness, MIN_ARC } from "@/lib/data-freshness";
import { applyPendingUpdate, useUpdateReady } from "@/lib/pwa-update";
import { isEditing } from "@/lib/is-editing";
import { useHoldMenu } from "./use-hold-menu";

/**
 * The floor on how long the working state is shown.
 *
 * A warm cache answers in under 20ms, and a control that flickers for one frame
 * reads as a control that did nothing — which is how a user ends up pressing it
 * four times and then reporting that refresh is broken. 420ms is long enough to
 * see and short enough that nobody is waiting on it; the refetch itself is not
 * being delayed, only the return to rest.
 */
const MIN_WORK_MS = 420;

/** Ring geometry, in the 24-unit viewBox. `pathLength` normalises the circle to
 *  100 units so the dash maths is a percentage and not a circumference. */
const R = 7.6;
const PATH = 100;

/**
 * The dial.
 *
 * Drawn here rather than in `nav-icons.tsx` for the reason the chevrons next
 * door are: the shared `sic()` helper fixes a 24px box and a 1.9 stroke tuned
 * for area glyphs, and this needs two different stroke weights in one mark —
 * a hairline track under a heavier arc — which is what keeps the drained state
 * legible instead of looking like a rendering artefact.
 */
function FreshnessDial({
  fraction,
  working,
  armed,
}: {
  fraction: number;
  working: boolean;
  armed: boolean;
}) {
  // While a refetch is in flight the ring is meaningless — the age it would be
  // reporting is about to be replaced. Show it full and let the spin carry the
  // state instead of animating a number nobody can use.
  const pct = working ? PATH : Math.max(MIN_ARC, fraction) * PATH;

  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={working ? "motion-safe:animate-spin" : undefined}
      aria-hidden
    >
      {/* The track: where the ring WOULD reach if the data were fresh. Without
          it a drained dial is just a short stroke, and short strokes read as a
          different icon rather than as the same icon with less in it. */}
      <circle className="rail-dial-track" cx="12" cy="12" r={R} />
      <circle
        className="rail-dial-arc"
        cx="12"
        cy="12"
        r={R}
        pathLength={PATH}
        /* Dashed rather than continuous while armed — a ring waiting on
           something outside the app should not look like a ring reporting a
           measurement. */
        strokeDasharray={armed ? "2.6 3.2" : PATH}
        strokeDashoffset={armed ? undefined : PATH - pct}
        /* Start the arc at twelve o'clock, where the arrowhead is, so the ring
           grows and erodes from the same place the eye starts. */
        transform="rotate(-90 12 12)"
      />
      {/* The arrowhead, parked at the arc's origin and pointing clockwise. It
          is the part that never moves and never disappears: it is what makes
          this a reload control at 8% ring as much as at 100%. */}
      <path
        d="M10.8 2.5 14.2 4.4 10.8 6.3 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Platform-correct chord labels. Alt on Windows and Linux is Option on a Mac,
 *  and a tooltip that says "Alt+R" to a Mac user is a tooltip they will not
 *  try. */
function useChordLabels() {
  return React.useMemo(() => {
    const mac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    return {
      soft: mac ? "⌥R" : "Alt+R",
      hard: mac ? "⌥⇧R" : "Alt+Shift+R",
    };
  }, []);
}

export function NavRefresh() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { fraction, ageMs, bump } = useDataFreshness();
  const updateReady = useUpdateReady();
  const chord = useChordLabels();

  const [working, setWorking] = React.useState(false);
  const [armed, setArmed] = React.useState(false);

  // Read inside callbacks that must not be rebuilt on every state change —
  // the keyboard listener and the reconnect subscription both hold one
  // reference for the lifetime of the shell.
  const workingRef = React.useRef(false);
  const armedRef = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setArmedBoth = React.useCallback((next: boolean) => {
    armedRef.current = next;
    setArmed(next);
  }, []);

  const softRefresh = React.useCallback(async () => {
    if (workingRef.current) return;

    // Offline: arm instead of failing, and press-again disarms. The refetch
    // would only produce a row of error states the user already knows about
    // from the offline pill — see `components/pwa/offline-indicator.tsx`.
    //
    // READ FROM THE MODULE, NOT FROM `useConnection()`. `reportReachable()`
    // fires its reconnect listeners SYNCHRONOUSLY, before React has re-rendered
    // anything — so an armed refresh firing on that transition would run with a
    // render-time `status` still saying "unreachable" and arm itself all over
    // again. The armed refresh would then never fire, which is the one thing
    // arming exists to guarantee.
    if (getConnection().status === "unreachable") {
      setArmedBoth(!armedRef.current);
      return;
    }

    setArmedBoth(false);
    workingRef.current = true;
    setWorking(true);
    const started = Date.now();
    try {
      // The coarse sweep, deliberately: a write in an ERP invalidates more than
      // the list it happened on, and so does a user asking for fresh data. This
      // is the same blast radius `useRefresh()` uses after a write.
      await qc.invalidateQueries({ queryKey: [TENANT_KEY] });
      const elapsed = Date.now() - started;
      if (elapsed < MIN_WORK_MS) {
        await new Promise((r) => window.setTimeout(r, MIN_WORK_MS - elapsed));
      }
    } finally {
      workingRef.current = false;
      if (alive.current) {
        setWorking(false);
        // Re-read the dial NOW rather than waiting up to fifteen seconds for
        // the next sample. This is the one transition the user is watching.
        bump();
      }
    }
  }, [qc, bump, setArmedBoth]);

  const hardReload = React.useCallback(() => {
    window.location.reload();
  }, []);

  // The armed refresh, fired by the connection monitor's own transition back to
  // reachable — not by `navigator.onLine`, which is true on a captive-portal
  // wifi and on a dropped VPN, i.e. in exactly the cases this is for.
  useRetryOnReconnect(() => {
    if (!armedRef.current) return;
    setArmedBoth(false);
    void softRefresh();
  });

  /*
   * ALT+R to refetch, ALT+SHIFT+R to reload.
   *
   * NOT ⌘R OR CTRL+SHIFT+R. Those are the browser's, they are the hard reload,
   * and taking them would mean the one chord a user already knows now does
   * something subtly different from what it does everywhere else — while ALSO
   * removing their way to ask for a real reload. Alt+R is free in Chrome, Edge
   * and Firefox, and in an installed window there is no menu bar for it to
   * collide with at all.
   *
   * Keyed on `e.code`, not `e.key`: Option+R on a Mac produces "®", so a
   * `key === "r"` test would never match on the platform where the chord is
   * spelled ⌥R.
   */
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return;
      if (isEditing(e.target)) return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code !== "KeyR") return;
      e.preventDefault();
      if (e.shiftKey) hardReload();
      else void softRefresh();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [softRefresh, hardReload]);

  const menu = useHoldMenu(true, () => void softRefresh());

  const tip = tipFor(t, {
    working,
    armed,
    updateReady,
    ageMs,
    chord: chord.soft,
  });

  return (
    <div className="relative">
      <Tooltip content={tip} side="right">
        <button
          type="button"
          className={cn(
            "rail-nav-btn",
            working && "is-working",
            armed && "is-armed",
          )}
          aria-label={tip}
          aria-busy={working}
          {...menu.handlers}
        >
          <FreshnessDial fraction={fraction} working={working} armed={armed} />
          {/* A staged build is a fact the toast can only state once, and only
              while it is on screen. The dot states it for as long as it is
              true. It does NOT change what a tap does — a control whose primary
              action silently changes under invisible state is how a user ends
              up reloading the app when they meant to refresh a table. */}
          {updateReady && <span className="rail-refresh-dot" aria-hidden />}
        </button>
      </Tooltip>
      {/*
        The menu anchors to the button without Radix owning the button's click:
        the trigger is an inert overlay pinned to the same box, so `open` stays
        ours to set from a hold or a right-click while a plain click still
        refetches. `modal={false}` keeps the rail behind it live, so a user who
        opened the menu by accident can simply press the control again.
      */}
      <DropdownMenu
        open={menu.open}
        onOpenChange={menu.setOpen}
        modal={false}
        align="start"
        label={navT(t, "Refresh")}
        trigger={
          <span
            className="pointer-events-none absolute inset-0"
            aria-hidden
            tabIndex={-1}
          />
        }
      >
        <DropdownLabel>{navT(t, "Refresh")}</DropdownLabel>
        {updateReady && (
          <DropdownItem onSelect={applyPendingUpdate}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate leading-tight">
                {navT(t, "Reload into new version")}
              </span>
              <span className="truncate text-[11px] leading-tight text-muted-foreground/70">
                {navT(t, "A newer build is downloaded and waiting")}
              </span>
            </span>
          </DropdownItem>
        )}
        <DropdownItem onSelect={() => void softRefresh()}>
          <MenuRow
            label={navT(t, "Refresh data")}
            hint={chord.soft}
            note={navT(t, "Refetch this screen without reloading")}
          />
        </DropdownItem>
        <DropdownItem onSelect={hardReload}>
          <MenuRow
            label={navT(t, "Reload app")}
            hint={chord.hard}
            note={navT(t, "Throws the tab away and boots again")}
          />
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}

function MenuRow({
  label,
  hint,
  note,
}: {
  label: string;
  hint: string;
  note: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-3">
        <span className="truncate leading-tight">{label}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
          {hint}
        </span>
      </span>
      <span className="truncate text-[11px] leading-tight text-muted-foreground/70">
        {note}
      </span>
    </span>
  );
}

/**
 * What the control says it will do, given what is true right now.
 *
 * Exported for the test, which is the only place the four branches can be
 * asserted side by side — three of them are states a screenshot cannot reach.
 */
export function tipFor(
  t: (k: string, o?: { defaultValue?: string; n?: number }) => string,
  s: {
    working: boolean;
    armed: boolean;
    updateReady: boolean;
    ageMs: number | null;
    chord: string;
  },
): string {
  if (s.working) return navT(t, "Refreshing…");
  if (s.armed)
    return navT(t, "Offline — will refresh when the connection returns");
  if (s.updateReady)
    return `${navT(t, "New version ready")} — ${navT(t, "hold to reload into it")}`;
  const age = ageLabel(t, s.ageMs);
  return age
    ? `${navT(t, "Refresh data")} — ${age} (${s.chord})`
    : `${navT(t, "Refresh data")} (${s.chord})`;
}

/** Age in the coarsest unit that is still true. Interpolated through i18next
 *  rather than concatenated, because "il y a 4 min" puts the number where
 *  English does not. */
function ageLabel(
  t: (k: string, o?: { defaultValue?: string; n?: number }) => string,
  ms: number | null,
): string | null {
  if (ms === null) return null;
  const secs = Math.floor(ms / 1000);
  if (secs < 60)
    return t("nav.updated_just_now", { defaultValue: "updated just now" });
  const mins = Math.floor(secs / 60);
  if (mins < 60)
    return t("nav.updated_minutes", {
      defaultValue: "updated {{n}} min ago",
      n: mins,
    });
  return t("nav.updated_hours", {
    defaultValue: "updated {{n}} h ago",
    n: Math.floor(mins / 60),
  });
}
