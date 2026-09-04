/**
 * Push opt-in control. Requests browser notification permission, subscribes this
 * device via the service worker's PushManager using the deploy-wide VAPID public
 * key (GET /notifications/push/public-key), and registers the subscription
 * (POST /notifications/push/subscribe). Toggling off unsubscribes both locally
 * and server-side. Degrades gracefully when the browser lacks push support or
 * the deployment hasn't configured VAPID yet.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { clearRotationToken } from "@/lib/push-token-store";
import {
  countRegisteredDevices,
  explainPushFailure,
  sendPushTest,
  syncPushSubscription,
} from "@/lib/push-sync";

const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export function PushOptIn() {
  const [supported] = React.useState(pushSupported());
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false); // VAPID not configured
  const [denied, setDenied] = React.useState(
    typeof Notification !== "undefined" && Notification.permission === "denied",
  );
  /**
   * How many devices the SERVER can reach this user on. `0` while the browser
   * says permission is granted is the silent failure: every endpoint we had was
   * returned as gone (a rotation the worker could not report, cleared site
   * data) and pruned, so the toggle reads "on" and nothing is arriving.
   * `null` means we have not asked, or could not.
   */
  const [devices, setDevices] = React.useState<number | null>(null);
  const [repairing, setRepairing] = React.useState(false);
  /**
   * The outcome of the last self-test: the one thing on this panel that is
   * evidence rather than inference. Everything else here reports what SHOULD be
   * true — permission is granted, a row exists — and the whole reason push
   * failures go unnoticed for months is that all of those can be true while
   * nothing arrives.
   */
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);

  // Reflect any existing subscription on mount, and — separately — ask the
  // server how many devices it can actually reach. The two can disagree, and
  // when they do the disagreement IS the bug worth showing.
  React.useEffect(() => {
    if (!supported) return;
    let live = true;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (live) setSubscribed(!!sub);
      } catch {
        /* SW not ready — leave as not subscribed */
      }
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = await countRegisteredDevices();
        if (live) setDevices(n);
      }
    })();
    return () => {
      live = false;
    };
  }, [supported]);

  /** Re-register this device without making the user toggle off and on again. */
  async function repair() {
    setRepairing(true);
    setError(null);
    try {
      const outcome = await syncPushSubscription();
      if (outcome === "skipped") {
        setError("Couldn't re-register this device. Try turning notifications off and on again.");
      } else {
        setSubscribed(true);
        setDevices(await countRegisteredDevices());
      }
    } finally {
      setRepairing(false);
    }
  }

  /**
   * Send one real notification to this account's devices, through the same code
   * an alert takes, and say what happened.
   *
   * It re-syncs this device first (see push-sync.sendPushTest): the commonest
   * cause of a silent failure — a subscription minted under a VAPID key the
   * deployment has since rotated away from — is repairable right here, so the
   * button repairs it and then proves the repair, rather than reporting a fault
   * the user can do nothing about.
   */
  async function test() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const r = await sendPushTest();
      setDevices(typeof r.devices === "number" ? r.devices : await countRegisteredDevices());
      setSubscribed(true);
      setTestResult(r.ok ? { ok: true } : { ok: false, message: explainPushFailure(r) });
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "The test couldn't be sent.",
      });
    } finally {
      setTesting(false);
    }
  }

  // Permission granted, and the server can reach nothing. Not the same as "not
  // subscribed": the user already did the setup, and it silently came undone.
  const lapsed = !denied && !unavailable && devices === 0;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const { public_key } = await tenant<{ public_key: string | null }>(
        "/notifications/push/public-key",
      );
      if (!public_key) {
        setUnavailable(true);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        setError(
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "Permission wasn't granted.",
        );
        return;
      }
      /*
       * The subscribe itself belongs to push-sync, which is the only place that
       * knows how to handle a browser already holding a subscription minted
       * under a superseded VAPID key. Doing it here as well was a second
       * implementation of the same thing that did NOT know that — and calling
       * `subscribe()` with a different applicationServerKey while an old
       * subscription is live throws InvalidStateError, so the toggle failed
       * with a browser error message on exactly the deployments that had just
       * rotated their keys. It also saves the rotation token, which is why that
       * is no longer done here.
       */
      const outcome = await syncPushSubscription();
      if (outcome === "skipped") {
        setError("Couldn't register this device. Try again in a moment.");
        return;
      }
      setSubscribed(true);
      setDevices(await countRegisteredDevices());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't enable push notifications.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await tenant("/notifications/push/subscribe", {
          method: "DELETE",
          body: { endpoint: sub.endpoint },
        }).catch(() => {});
        await sub.unsubscribe();
      }
      // The rotation token is worthless once the device is gone, and leaving it
      // behind would have the worker try to rotate a subscription nobody wants.
      await clearRotationToken();
      setSubscribed(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't turn off push notifications.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Push notifications aren't supported in this browser. Install the app or
        use a modern browser to enable them.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          Push notifications on this device
        </p>
        <p className="text-[13px] text-muted-foreground">
          {unavailable
            ? "Not available yet — your administrator hasn't configured push delivery."
            : denied
              ? "Blocked in your browser settings. Allow notifications for this site to enable."
              : lapsed
                ? "This device stopped receiving notifications — browsers do this on their own from time to time. Reconnect it to start getting alerts again."
                : subscribed
                  ? "You'll get alerts here even when the app is closed."
                  : "Get alerts on this device even when the app is closed."}
        </p>
        {error && (
          <p className="mt-1 text-[13px] text-[rgb(var(--bad))]">{error}</p>
        )}
        {testResult && (
          <p
            className={
              testResult.ok
                ? "mt-1 text-[13px] text-[rgb(var(--good))]"
                : "mt-1 text-[13px] text-[rgb(var(--bad))]"
            }
          >
            {testResult.ok
              ? "Sent — it should appear on this device within a few seconds. If it doesn't, check that notifications are allowed for this app in your phone's settings."
              : testResult.message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/*
          Only once there is something to test. Offering it while the device is
          unregistered would produce a failure that says nothing except "you
          have not turned this on yet", which the toggle beside it already says.
        */}
        {subscribed && !unavailable && !denied && (
          <button
            type="button"
            onClick={test}
            disabled={busy || repairing || testing}
            className="rounded-lg border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send a test"}
          </button>
        )}
      <button
        type="button"
        onClick={lapsed ? repair : subscribed ? disable : enable}
        disabled={busy || repairing || unavailable || (denied && !subscribed)}
        className={
          subscribed && !lapsed
            ? "rounded-lg border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            : "rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        }
      >
        {busy || repairing ? "…" : lapsed ? "Reconnect" : subscribed ? "Turn off" : "Enable"}
      </button>
      </div>
    </div>
  );
}
