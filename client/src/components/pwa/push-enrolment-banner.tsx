/**
 * The prompt that asks a user to turn push on — outside Settings, where they
 * will actually see it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Push has been fully built here for a long time: VAPID, key rotation, per-tenant
 * icons, an email fallback. The opt-in for it is a toggle inside
 * Notifications → Preferences, which is two navigations from anywhere anyone
 * works. So almost nobody has a registered device, and the entire push
 * pipeline — the one thing that reaches a person who is not looking at the
 * app — delivers to nobody.
 *
 * ── WHY IT IS A BANNER AND NOT A PROMPT ON LOGIN ───────────────────────────
 *
 * `Notification.requestPermission()` can be answered "denied", and denied is
 * close to permanent: we cannot ask again, and recovery means the user finding
 * browser site-settings on their own. A prompt that appears unbidden on first
 * login gets reflex-dismissed, and a reflex dismissal costs that person push
 * forever.
 *
 * So the browser prompt is only ever raised by a deliberate click on a control
 * that has already said what it is for. Dismissing the banner costs nothing and
 * is remembered; the Settings toggle remains the permanent home.
 *
 * It stays quiet unless there is something to fix: not supported, already
 * subscribed, already denied, no VAPID keypair on the deployment, or previously
 * dismissed → renders nothing.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { enablePushOnThisDevice, pushSupported } from "@/lib/push-sync";
import { useToast } from "@/components/ui/toast";

const DISMISS_KEY = "praxis.push-enrol-dismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    /* @silent:storage — unreadable storage means we cannot tell whether they
       dismissed it. Erring toward NOT nagging: a banner that reappears every
       load is worse than one that never appears. */
    return true;
  }
}

function remember(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* @silent:storage — it will simply ask again next session. */
  }
}

const BellGlyph = () => (
  <svg
    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function PushEnrolmentBanner() {
  const toast = useToast();
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    (async () => {
      if (!pushSupported() || dismissed()) return;
      // Already granted means either subscribed or lapsed; the Settings panel
      // handles lapse repair and says far more about it than a banner can.
      if (Notification.permission !== "default") return;
      try {
        const reg = await navigator.serviceWorker.ready;
        if (await reg.pushManager.getSubscription()) return;
      } catch {
        /* @silent:teardown — no service worker registration to inspect, so
           there is nothing this banner could switch on. */
        return;
      }
      if (live) setShow(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    const res = await enablePushOnThisDevice();
    setBusy(false);
    if (res.ok) {
      setShow(false);
      remember();
      toast.success("This device will now get urgent alerts.");
      return;
    }
    if (res.reason === "denied") {
      // Nothing to retry — only browser settings can undo this. Say so once and
      // stop asking, rather than leaving a button that cannot work.
      setShow(false);
      remember();
      toast.error(
        "Your browser is blocking notifications. Allow them for this site in your browser settings.",
      );
      return;
    }
    if (res.reason === "unconfigured") {
      setShow(false);
      remember();
      toast.info("Push isn't set up on this workspace yet.");
      return;
    }
    // "dismissed" or "failed": both recoverable, so the banner stays.
    toast.error("Couldn't turn on alerts. Try again in a moment.");
  }

  return (
    <div
      role="region"
      aria-label="Turn on urgent alerts"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl border border-border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-none text-primary-ink">
          <BellGlyph />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Don't miss an approval
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get approvals, messages and urgent alerts on this device — even when
            Praxis isn't open.{" "}
            <Link to="/notifications" className="text-primary-ink underline-offset-2 hover:underline">
              Choose what interrupts you
            </Link>
            .
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Turning on…" : "Turn on alerts"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShow(false);
                remember();
              }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
