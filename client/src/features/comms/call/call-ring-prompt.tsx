/**
 * "Allow this device to ring for calls" — asked once, for people who can
 * take calls, on a device that cannot ring while the app is closed (calls
 * audit A15, PR-4 step 9; pixie-girl-hub's CallPushGate behaviour).
 *
 * The browser's permission prompt is only raised by the button here, never on
 * its own: a reflex "Block" costs that device every ring after. On an iPhone
 * or iPad in a browser tab there is nothing to allow yet — Safari delivers
 * web push to installed apps only — so the prompt explains Add to Home Screen
 * instead of offering a button that cannot work. "Not now" is remembered on
 * this device; Settings → Calls keeps the full check and a Test ring.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { enablePushOnThisDevice } from "@/lib/push-sync";
import { checkDeviceRing, canRingWhenClosed, needsInstall, type DeviceRingStatus } from "./device-ring-check";

const DISMISS_KEY = "praxis.call-ring-prompt-dismissed";

function dismissedHere(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    /* @silent:storage — unreadable: do not nag. */
    return true;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* @silent:storage — it will ask again next session. */
  }
}

export function CallRingPrompt({ callsAvailable }: { callsAvailable: boolean | null }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<DeviceRingStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [hidden, setHidden] = React.useState(dismissedHere);

  React.useEffect(() => {
    if (!callsAvailable || hidden) return;
    let live = true;
    void checkDeviceRing().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [callsAvailable, hidden]);

  if (!callsAvailable || hidden || !status) return null;
  if (canRingWhenClosed(status)) return null;
  // Denied needs the browser's own settings; unsupported needs another
  // browser. Settings → Calls says both; a banner here cannot fix either.
  const install = needsInstall(status);
  if (!install && (status.permission === "denied" || status.permission === "unsupported")) return null;

  const close = () => {
    rememberDismissed();
    setHidden(true);
  };

  async function allow() {
    setBusy(true);
    const res = await enablePushOnThisDevice();
    setBusy(false);
    if (res.ok) {
      toast.success(tr("This device will ring for calls, even with the app closed."));
      close();
    } else if (res.reason === "denied") {
      toast.error(tr("Notifications are blocked for this site. Allow them in your browser settings to get calls here."));
      close();
    } else if (res.reason === "unconfigured") {
      toast.info(tr("Push is not set up on this workspace yet."));
      close();
    } else {
      toast.error(tr("Could not turn on call rings. Try again from Settings → Calls."));
    }
  }

  return (
    <div
      role="region"
      aria-label={tr("Allow this device to ring for calls")}
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl border border-border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4"
    >
      <p className="text-sm font-semibold text-foreground">{tr("Allow this device to ring for calls")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {install
          ? tr("On iPhone and iPad, calls ring only in the installed app: tap Share, then Add to Home Screen, and open Praxis from the new icon.")
          : tr("Without this, a call rings here only while the app is open on screen.")}{" "}
        <Link to="/settings/calls" className="text-primary-ink underline-offset-2 hover:underline">
          {tr("Check this device")}
        </Link>
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {!install && (
          <Button size="sm" onClick={() => void allow()} loading={busy} icon={null}>
            {tr("Allow calls to ring here")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={close} icon={null}>
          {tr("Not now")}
        </Button>
      </div>
    </div>
  );
}
