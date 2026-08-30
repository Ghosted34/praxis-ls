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
import { saveRotationToken, clearRotationToken } from "@/lib/push-token-store";
import { countRegisteredDevices, syncPushSubscription } from "@/lib/push-sync";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

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
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      const res = await tenant<{ rotation_token?: string | null }>(
        "/notifications/push/subscribe",
        { method: "POST", body: { subscription: sub.toJSON() } },
      );
      // Hand the service worker what it needs to repair this device on its own
      // when the browser rotates the subscription — see lib/push-token-store.
      if (res && res.rotation_token) await saveRotationToken(res.rotation_token);
      setSubscribed(true);
      setDevices(null);
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
      </div>
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
  );
}
