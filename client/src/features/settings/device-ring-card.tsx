/**
 * Settings → Calls → "This device" (calls audit A15, PR-4 step 9).
 *
 * Whether a call can ring on THIS device with the app closed, line by line,
 * each with the fix: notifications allowed, a push registration for this
 * device, the installed app (required on iPhone and iPad), and the ring sound
 * in an open tab. "Send a test ring" sends a real ring push to this device
 * only, and says when it arrives.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { enablePushOnThisDevice, syncPushSubscription } from "@/lib/push-sync";
import { unlockAudio } from "@/lib/notif-sound";
import { sendTestRing, type TestRingResult } from "@/lib/smartcomm-api";
import { errMsg } from "@/lib/use-resource";
import {
  checkDeviceRing, canRingWhenClosed, needsInstall, type DeviceRingStatus,
} from "@/features/comms/call/device-ring-check";

type Line = { label: string; ok: boolean; state: string; fix?: React.ReactNode };

function testRingMessage(r: TestRingResult): { tone: "ok" | "warn"; text: string } {
  if (r.sent > 0) return { tone: "ok", text: tr("Test ring sent. This device should ring within a few seconds.") };
  if (r.reason === "push not configured") return { tone: "warn", text: tr("Push is not set up on this workspace yet.") };
  if (r.total === 0) return { tone: "warn", text: tr("This device is not registered for push. Register it above, then try again.") };
  return { tone: "warn", text: tr("The push service refused the ring. Register this device again, then try again.") };
}

export function DeviceRingCard({
  check = checkDeviceRing,
  testRing = sendTestRing,
}: {
  check?: () => Promise<DeviceRingStatus>;
  testRing?: (endpoint: string) => Promise<TestRingResult>;
}) {
  const [status, setStatus] = React.useState<DeviceRingStatus | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [received, setReceived] = React.useState(false);

  const refresh = React.useCallback(async () => setStatus(await check()), [check]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // The service worker says when the test ring reached this device.
  React.useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    const onMessage = (ev: MessageEvent) => {
      if ((ev.data as { type?: string } | null)?.type === "praxis:call-test") setReceived(true);
    };
    sw?.addEventListener?.("message", onMessage);
    return () => sw?.removeEventListener?.("message", onMessage);
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setResult({ tone: "warn", text: errMsg(e) });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  if (!status) return null;
  const install = needsInstall(status);

  const lines: Line[] = [
    {
      label: tr("Notifications"),
      ok: status.permission === "granted",
      state:
        status.permission === "granted" ? tr("Allowed")
        : status.permission === "denied" ? tr("Blocked by the browser")
        : status.permission === "default" ? tr("Not allowed yet")
        : install ? tr("Needs the installed app") : tr("Not supported by this browser"),
      fix:
        status.permission === "default" ? (
          <Button size="sm" icon={null} loading={busy === "allow"} onClick={() => void run("allow", enablePushOnThisDevice)}>
            {tr("Allow")}
          </Button>
        ) : status.permission === "denied" ? (
          <span>{tr("Allow notifications for this site in your browser's settings, then reload.")}</span>
        ) : status.permission === "unsupported" && !install ? (
          <span>{tr("Use Chrome, Edge, Firefox or Safari to get calls on this device.")}</span>
        ) : undefined,
    },
    {
      label: tr("Push registration for this device"),
      ok: status.subscribed === true,
      state: status.subscribed === true ? tr("Registered") : status.subscribed === false ? tr("Not registered") : tr("Unknown"),
      fix:
        status.permission === "granted" && status.subscribed !== true ? (
          <Button size="sm" icon={null} loading={busy === "register"} onClick={() => void run("register", syncPushSubscription)}>
            {tr("Register this device")}
          </Button>
        ) : undefined,
    },
    {
      label: tr("Installed app"),
      ok: status.installed || !status.ios,
      state: status.installed ? tr("Installed") : status.ios ? tr("Required on iPhone and iPad") : tr("Optional"),
      fix: install ? (
        <span>{tr("In Safari, tap Share, then Add to Home Screen, and open Praxis from the new icon. Come back here from the installed app.")}</span>
      ) : !status.installed ? (
        <span>{tr("Without it, calls ring here only while the browser is running.")}</span>
      ) : undefined,
    },
    {
      label: tr("Ring sound in an open tab"),
      ok: !status.soundBlocked,
      state: status.soundBlocked ? tr("Silent until you tap the page") : tr("Ready"),
      fix: status.soundBlocked ? (
        <Button size="sm" variant="outline" icon={null} onClick={() => { unlockAudio(); void refresh(); }}>
          {tr("Tap to enable ring sound")}
        </Button>
      ) : undefined,
    },
  ];

  const ready = canRingWhenClosed(status);

  return (
    <Panel title={tr("This device")} className="mb-4">
      <p className="text-sm text-muted-foreground">
        {ready
          ? tr("Calls ring on this device, even with the app closed.")
          : tr("Calls ring on this device only while the app is open on screen. Fix the lines below to change that.")}
      </p>
      <ul className="mt-4 divide-y divide-border">
        {lines.map((l) => (
          <li key={l.label} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1 text-sm text-foreground">{l.label}</span>
            <span className={cn("text-sm", l.ok ? "text-ok" : "text-warn")}>{l.state}</span>
            {l.fix && <span className="text-xs text-muted-foreground sm:max-w-xs">{l.fix}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          icon={null}
          disabled={!status.endpoint}
          loading={busy === "test"}
          onClick={() =>
            void run("test", async () => {
              setReceived(false);
              setResult(null);
              if (!status.endpoint) return;
              setResult(testRingMessage(await testRing(status.endpoint)));
            })
          }
        >
          {tr("Send a test ring")}
        </Button>
        {!status.endpoint && (
          <span className="text-xs text-muted-foreground">{tr("Register this device first.")}</span>
        )}
      </div>
      {result && (
        <Callout tone={result.tone} className="mt-3">
          {result.text}
          {received && result.tone === "ok" ? ` ${tr("Received on this device.")}` : ""}
        </Callout>
      )}
    </Panel>
  );
}
