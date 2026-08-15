/**
 * WS-M1 — the maintenance banner tenant users actually see.
 *
 * The window has been schedulable from the Platform Console for a while, but
 * nothing ever told a tenant user about it: the record existed and the read-only
 * mode blocked nothing. This is the half that makes "announced maintenance"
 * mean something.
 *
 * ── WHY IT SITS IN THE DOCUMENT FLOW, UNLIKE THE OTHER TWO BANNERS ──────────
 *
 * `AccessBanner` floats bottom-right and `ActionErrorBanner` floats under the
 * chrome, both because they interrupt someone mid-task over something they can
 * safely ignore. This is the opposite case. During a READ_ONLY window every
 * save in the application will fail, and a message the user can scroll past —
 * or that a table renders on top of — turns a planned, explained pause into
 * "the app is broken". So it takes real space at the very top, above the shell.
 *
 * ── WHY IT IS NOT DISMISSIBLE WHILE WRITES ARE BLOCKED ─────────────────────
 *
 * A dismissed banner is indistinguishable from no banner, and the user would
 * then hit a 423 on their next save with the explanation already thrown away.
 * An UPCOMING window is dismissible, because nothing is broken yet and the
 * point there is notice, not explanation.
 *
 * ── WHY IT RENDERS ABOVE THE LOGIN SCREEN TOO ──────────────────────────────
 *
 * Mounted inside BootGate rather than AppShell, so it appears on every route
 * including `/login`. During a fleet-wide window the people who most need the
 * message are the ones staring at a login screen wondering why nothing works —
 * gating it behind a session would hide it from exactly them. The endpoint it
 * reads is unauthenticated for the same reason.
 */
import { useEffect, useState } from "react";
import { tenant } from "@/lib/api-client";
import { Callout } from "@/components/ui/callout";
import { XIcon } from "@/components/ui/icons";

type MaintenanceWindow = {
  maintenance_window_id: string;
  title: string;
  message: string | null;
  mode: "ANNOUNCE" | "READ_ONLY";
  starts_at: string;
  ends_at: string;
  state: "ACTIVE" | "UPCOMING";
  starts_in_minutes: number;
  writes_blocked: boolean;
};

/** How often to re-check. A window opens or closes on a clock, so the banner
 *  must be able to appear and disappear without the user reloading. */
const POLL_MS = 60_000;

/**
 * Is this actually a maintenance window?
 *
 * The endpoint returns `null` almost always, and this component sits above
 * every route including the login screen — so it is the one component most
 * likely to be handed something unexpected: a stubbed response, a proxy's
 * error page, a half-deployed API.
 *
 * Trusting truthiness alone is not enough. An empty object is truthy, and it
 * renders as "undefined — scheduled in NaN" — which is worse than showing
 * nothing twice over. It is nonsense in front of every user, and because
 * `Callout` is a `role="status"` live region, a screen reader announces it.
 *
 * So: validate the fields this component actually reads, and render nothing
 * unless they are all present and sane.
 */
function isWindow(w: unknown): w is MaintenanceWindow {
  if (!w || typeof w !== "object") return false;
  const c = w as Partial<MaintenanceWindow>;
  return (
    typeof c.maintenance_window_id === "string" &&
    typeof c.title === "string" &&
    c.title.length > 0 &&
    (c.state === "ACTIVE" || c.state === "UPCOMING") &&
    typeof c.ends_at === "string" &&
    !Number.isNaN(new Date(c.ends_at).getTime())
  );
}

function humanDuration(minutes: number): string {
  if (minutes < 1) return "shortly";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function endsAtLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MaintenanceBanner() {
  const [win, setWin] = useState<MaintenanceWindow | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      tenant<unknown>("/maintenance")
        .then((w) => live && setWin(isWindow(w) ? w : null))
        // Silent: a banner endpoint that cannot be reached must not produce an
        // error about the feature that exists to explain errors. Worst case the
        // user simply doesn't see the notice.
        .catch(() => live && setWin(null));
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (!win) return null;

  // Dismissal is per window id, so a NEW window after a dismissed one still
  // shows. Never honoured while writes are blocked.
  const dismissible = !win.writes_blocked;
  if (dismissible && dismissedId === win.maintenance_window_id) return null;

  const tone = win.writes_blocked
    ? "warn"
    : win.mode === "READ_ONLY"
      ? "warn"
      : "info";

  const headline = win.writes_blocked
    ? `${win.title} — changes are paused until ${endsAtLabel(win.ends_at)}.`
    : win.state === "ACTIVE"
      ? `${win.title} — in progress until ${endsAtLabel(win.ends_at)}.`
      : win.mode === "READ_ONLY"
        ? `${win.title} — starting ${humanDuration(win.starts_in_minutes)}. Saving will be paused during this window.`
        : `${win.title} — scheduled ${humanDuration(win.starts_in_minutes)}.`;

  return (
    <div className="px-3 pt-3">
      <Callout
        tone={tone}
        action={
          dismissible ? (
            <button
              type="button"
              onClick={() => setDismissedId(win.maintenance_window_id)}
              aria-label="Dismiss"
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon width={14} height={14} />
            </button>
          ) : undefined
        }
      >
        <span className="font-semibold">{headline}</span>
        {win.message ? <span className="ml-1">{win.message}</span> : null}
      </Callout>
    </div>
  );
}
