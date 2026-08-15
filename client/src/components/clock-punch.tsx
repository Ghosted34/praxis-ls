/**
 * Clock-punch chip for the bottom-right floating cluster — THE place employees
 * clock in/out (not the Attendance screen, which is the manager view). Always
 * shows the time; tapping captures the device GPS and clocks in or out, with a
 * dot for on-shift and a transient result. Users not linked to an employee still
 * see the clock — tapping just tells them their account isn't linked.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const ClockIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={20}
    height={20}
    aria-hidden
    {...p}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/**
 * The clock state and the punch action, without a presentation.
 *
 * Extracted in Phase 5 because the FAB that used to be the only home for this
 * is now touch-only (audit F9), and the desktop quick-actions menu needs the
 * same behaviour in a completely different shape — a menu item, not a round
 * button with a floating chip. Two renderings, one source of truth for whether
 * the user is on shift.
 */
export function useClockPunch() {
  const [now, setNow] = React.useState(() => new Date());
  const [punch, setPunch] = React.useState<api.AttendanceRow | null>(null);
  const [canPunch, setCanPunch] = React.useState(true); // false = no employee linked
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; bad?: boolean } | null>(
    null,
  );

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  React.useEffect(() => {
    let live = true;
    api
      .openPunch()
      .then((p) => {
        if (live) setPunch(p);
      })
      .catch(() => {
        if (live) setCanPunch(false);
      }); // not linked to an employee
    return () => {
      live = false;
    };
  }, []);

  const clockedIn = canPunch && !!punch && !punch.clock_out_at;

  async function toggle() {
    if (!canPunch) {
      setMsg({ text: "Your account isn't linked to an employee", bad: true });
      setTimeout(() => setMsg(null), 4000);
      return;
    }
    setBusy(true);
    setMsg(null);
    let fix: api.Fix | null = null;
    let fixFailed = false;
    try {
      fix = await api.getFix();
    } catch {
      // B3 (class G — config-adjacent). The previous /* proceed without
      // location */ was silent, which meant a user under the tenant's `warn`
      // geofence policy punched without location and never knew — the row
      // was recorded with `within_geofence: null` and the manager saw an
      // untraceable punch. Under `block`, the server will refuse with a
      // 422 whose message names the missing worksite; under `warn`, the row
      // is accepted and the warning below is the only signal the user ever
      // gets that the fix failed. Distinct from the "off-site" case, which
      // means we HAD a location and it was outside the worksite — that
      // stays "Clocked in · off-site".
      fixFailed = true;
    }
    try {
      if (clockedIn) {
        await api.clockOut(
          fix ? { latitude: fix.latitude, longitude: fix.longitude } : {},
        );
        setPunch(null);
        setMsg({
          text: fixFailed ? "Clocked out · no location" : "Clocked out",
          bad: fixFailed,
        });
      } else {
        // The device rides with the punch, not as a separate registration call:
        // registering has to happen on first use or a tenant on `block` has a
        // chicken-and-egg problem — you cannot get on the register without
        // punching and cannot punch without being on it. The server puts the
        // row down first and refuses second, so a refused punch still leaves a
        // dated device for a manager to approve.
        const row = await api.clockIn({
          ...(fix || {}),
          device: api.deviceInfo(),
        });
        setPunch(row);
        const noLoc = fixFailed || row.within_geofence === null;
        const offSite = row.within_geofence === false;
        setMsg({
          text: offSite
            ? "Clocked in · off-site"
            : noLoc
              ? "Clocked in · no location"
              : "Clocked in",
          bad: offSite || noLoc,
        });
      }
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Failed", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const label = msg ? msg.text : clockedIn ? "On the clock" : timeStr;
  const action = canPunch ? (clockedIn ? "Clock out" : "Clock in") : "Time";

  return { label, action, clockedIn, canPunch, busy, toggle, msg, timeStr };
}

/**
 * Title-bar clock chip — the DESKTOP home for the punch, beside LIVE/TEST.
 *
 * WHY A THIRD RENDERING. The punch had two homes and neither was reachable at a
 * glance on desktop: the FAB is `md:hidden` (audit F9), and the quick-actions
 * menu hides it one click deep behind a burst icon that gives no hint a shift is
 * running. Clocking in is not a "quick action" — it is a state the person is in
 * for eight hours, and the chrome should say so without being opened. The
 * utility strip is where the app already keeps the other always-true facts
 * (which environment, which account), so it belongs there.
 *
 * The label collapses below `lg` so it cannot push the search field off the row;
 * the dot and the icon still carry on-shift/off-shift at every width.
 */
export function ClockPunchChip() {
  const { label, action, clockedIn, canPunch, busy, toggle, msg } =
    useClockPunch();

  return (
    <button
      type="button"
      onClick={() => {
        void toggle();
      }}
      disabled={busy}
      title={`${action} · ${label}`}
      // Named with the state, not just the verb: a screen-reader user should
      // hear whether they are on the clock without activating the control.
      aria-label={`${action}. ${clockedIn ? "On the clock" : "Not clocked in"}`}
      className={cn(
        "hidden h-9 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60 sm:inline-flex",
        clockedIn && "border-[rgb(var(--ok)_/_0.4)] text-[rgb(var(--ok))]",
        msg?.bad && "border-[rgb(var(--bad)_/_0.4)] text-[rgb(var(--bad))]",
      )}
    >
      <span className="relative inline-grid place-items-center">
        <ClockIcon width={16} height={16} />
        {canPunch && (
          <span
            aria-hidden
            className={cn(
              "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-background",
              clockedIn ? "bg-ok-fill" : "bg-[rgb(var(--ink-3)/0.4)]",
            )}
          />
        )}
      </span>
      <span className="hidden text-[11px] font-semibold tabular-nums lg:inline">
        {label}
      </span>
    </button>
  );
}

export function ClockPunch() {
  const { label, action, clockedIn, canPunch, busy, toggle, msg } =
    useClockPunch();

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <span
        className={cn(
          "rounded-md border bg-popover px-2 py-1 text-xs font-medium tabular-nums shadow-md",
          msg?.bad ? "text-[rgb(var(--bad))]" : "text-foreground",
        )}
      >
        {label}
      </span>
      <button
        onClick={toggle}
        disabled={busy}
        title={action}
        aria-label={action}
        className="relative grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg transition-colors duration-150 hover:bg-accent hover:text-primary-ink disabled:opacity-60"
      >
        <ClockIcon />
        {canPunch && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-background",
              clockedIn ? "bg-ok-fill" : "bg-[rgb(var(--ink-3)/0.4)]",
            )}
          />
        )}
      </button>
    </div>
  );
}
