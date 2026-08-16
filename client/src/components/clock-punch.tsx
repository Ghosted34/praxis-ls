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
  /**
   * The device this punch just registered, when it had never been seen before.
   *
   * Held so the clock can offer "name this device?" ONCE, on the punch that
   * created it. The employee is the only person who knows the answer — a
   * manager renaming it later is guessing which of two "Windows · Chrome"
   * rows is the yard tablet — but they are also mid-clock-in, so this is an
   * offer beside a completed punch, never a gate in front of one.
   */
  const [newDevice, setNewDevice] = React.useState<string | null>(null);
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
        // Offered only on the punch that created the row — `device_new` is
        // transient and true exactly once, so this cannot become a nag.
        if (row.device_new && row.hr_device_id) setNewDevice(row.hr_device_id);
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

  return {
    label, action, clockedIn, canPunch, busy, toggle, msg, timeStr,
    newDevice,
    dismissNewDevice: () => setNewDevice(null),
  };
}

/**
 * "Name this device?" — offered once, beside a punch that already succeeded.
 *
 * WHY THE EMPLOYEE AND NOT THE MANAGER. The server can only derive a browser
 * category from the user agent, so every laptop in the company auto-labels
 * identically and it appends four characters of the fingerprint to keep the rows
 * distinct. Distinct is not recognisable. The person holding the device is the
 * only one who can say "my phone" or "yard tablet"; a manager renaming it later
 * is guessing which of two near-identical rows is which.
 *
 * WHY IT IS AN OFFER, NOT A STEP. They are clocking in. The punch is recorded
 * before this appears and stays recorded if they ignore it — a naming dialog in
 * front of a time clock would be dismissed by everyone in a hurry, which is
 * everyone. Skipping leaves the generated label, which the manager can still fix.
 */
function NameDeviceOffer({ deviceId, onDone }: { deviceId: string; onDone: () => void }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const label = value.trim();
    if (!label) return onDone();
    setBusy(true);
    setError(null);
    try {
      await api.renameOwnDevice(deviceId, label);
      onDone();
    } catch (err) {
      // Named rather than swallowed: the punch is safe either way, but somebody
      // who typed a name and saw it vanish would reasonably think it saved.
      setError(err instanceof Error ? err.message : "Couldn't save that name.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      /*
       * POSITION-AGNOSTIC. The caller places it, because the two surfaces need
       * opposite anchors: the title-bar chip drops it downward, the touch
       * cluster — already pinned to the bottom of the screen — opens it upward.
       * Baking `top-full` in here would put it off-screen on a phone.
       *
       * Anchored to the control either way rather than centred as a modal: it
       * belongs to the thing that raised it, and a dialog would take the whole
       * screen for a question the person did not ask.
       */
      className="w-72 rounded-lg border bg-popover p-3 shadow-[var(--shadow-l)]"
    >
      <p className="text-sm font-medium text-foreground">Name this device</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        First time clocking in from here. A name helps your manager tell your devices apart.
      </p>
      <input
        // Focus follows a prompt the person did not ask for, so it must not
        // steal the caret from anything they were typing — it only appears
        // after their own click on the clock.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        maxLength={80}
        aria-label="Device name"
        placeholder="My phone, Yard tablet…"
        className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      {error && <p className="mt-1 text-xs text-[rgb(var(--bad))]">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Not now
        </button>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
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
  const { label, action, clockedIn, canPunch, busy, toggle, msg, newDevice, dismissNewDevice } =
    useClockPunch();

  return (
    /*
     * `relative` so the naming offer can anchor to the chip — the title bar is a
     * drag region (`.wco`), and a popover that escaped this wrapper would be
     * positioned against the window rather than the control that raised it.
     *
     * THE BREAKPOINT LIVES HERE, NOT ONLY ON THE BUTTON. This wrapper is a flex
     * child of a `gap-2` row, so while the button inside was hidden below `sm`
     * the wrapper still consumed a gap — eight pixels stolen from the title
     * bar's drag handle at 320px, which the layout gate caught as a 10px spacer
     * against a 16px floor. A hidden control must take no space at all,
     * including the space BETWEEN it and its neighbour.
     */
    <span className="relative hidden sm:inline-flex">
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
        // No `hidden sm:inline-flex` here any more — the wrapper owns the
        // breakpoint, so the button is simply always laid out inside it.
        "inline-flex h-9 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60",
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
    {newDevice && (
      <div className="absolute right-0 top-full z-50 mt-2">
        <NameDeviceOffer deviceId={newDevice} onDone={dismissNewDevice} />
      </div>
    )}
    </span>
  );
}

export function ClockPunch() {
  const { label, action, clockedIn, canPunch, busy, toggle, msg, newDevice, dismissNewDevice } =
    useClockPunch();

  return (
    // `relative` for the same reason as the chip: the naming offer anchors to
    // this cluster. On touch it sits above the FAB rather than below, which is
    // where there is room — the cluster is already at the bottom of the screen.
    <div className="relative flex items-center gap-2 animate-fade-in">
      {newDevice && (
        <div className="absolute bottom-full right-0 z-50 mb-2">
          <NameDeviceOffer deviceId={newDevice} onDone={dismissNewDevice} />
        </div>
      )}
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
