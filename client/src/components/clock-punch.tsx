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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={20} height={20} aria-hidden {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export function ClockPunch() {
  const [now, setNow] = React.useState(() => new Date());
  const [punch, setPunch] = React.useState<api.AttendanceRow | null>(null);
  const [canPunch, setCanPunch] = React.useState(true); // false = no employee linked
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; bad?: boolean } | null>(null);

  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id); }, []);
  React.useEffect(() => {
    let live = true;
    api.openPunch()
      .then((p) => { if (live) setPunch(p); })
      .catch(() => { if (live) setCanPunch(false); }); // not linked to an employee
    return () => { live = false; };
  }, []);

  const clockedIn = canPunch && !!punch && !punch.clock_out_at;

  async function toggle() {
    if (!canPunch) {
      setMsg({ text: "Your account isn't linked to an employee", bad: true });
      setTimeout(() => setMsg(null), 4000);
      return;
    }
    setBusy(true); setMsg(null);
    let fix: api.Fix | null = null;
    try { fix = await api.getFix(); } catch { /* proceed without location */ }
    try {
      if (clockedIn) {
        await api.clockOut(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {});
        setPunch(null);
        setMsg({ text: "Clocked out" });
      } else {
        const row = await api.clockIn(fix || {});
        setPunch(row);
        setMsg({ text: row.within_geofence === false ? "Clocked in · off-site" : "Clocked in", bad: row.within_geofence === false });
      }
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Failed", bad: true });
    } finally { setBusy(false); }
  }

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const label = msg ? msg.text : clockedIn ? "On the clock" : timeStr;

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <span className={cn("rounded-md border bg-popover px-2 py-1 text-xs font-medium tabular-nums shadow-md", msg?.bad ? "text-[rgb(var(--bad))]" : "text-foreground")}>
        {label}
      </span>
      <button
        onClick={toggle}
        disabled={busy}
        title={canPunch ? (clockedIn ? "Clock out" : "Clock in") : "Time"}
        aria-label={canPunch ? (clockedIn ? "Clock out" : "Clock in") : "Time"}
        className="relative grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg transition-transform hover:scale-105 hover:text-[rgb(var(--primary))] disabled:opacity-60"
      >
        <ClockIcon />
        {canPunch && (
          <span className={cn("absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-background", clockedIn ? "bg-ok-fill" : "bg-[rgb(var(--ink-3)/0.4)]")} />
        )}
      </button>
    </div>
  );
}
