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
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function PushOptIn() {
  const [supported] = React.useState(pushSupported());
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false); // VAPID not configured
  const [denied, setDenied] = React.useState(typeof Notification !== "undefined" && Notification.permission === "denied");

  // Reflect any existing subscription on mount.
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
    })();
    return () => {
      live = false;
    };
  }, [supported]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const { public_key } = await tenant<{ public_key: string | null }>("/notifications/push/public-key");
      if (!public_key) {
        setUnavailable(true);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setDenied(permission === "denied");
        setError(permission === "denied" ? "Notifications are blocked in your browser settings." : "Permission wasn't granted.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      await tenant("/notifications/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
      setSubscribed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't enable push notifications.");
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
        await tenant("/notifications/push/subscribe", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn off push notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Push notifications aren't supported in this browser. Install the app or use a modern browser to enable them.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Push notifications on this device</p>
        <p className="text-[13px] text-muted-foreground">
          {unavailable
            ? "Not available yet — your administrator hasn't configured push delivery."
            : denied
              ? "Blocked in your browser settings. Allow notifications for this site to enable."
              : subscribed
                ? "You'll get alerts here even when the app is closed."
                : "Get alerts on this device even when the app is closed."}
        </p>
        {error && <p className="mt-1 text-[13px] text-[rgb(var(--bad))]">{error}</p>}
      </div>
      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={busy || unavailable || (denied && !subscribed)}
        className={
          subscribed
            ? "rounded-lg border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            : "rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        }
      >
        {busy ? "…" : subscribed ? "Turn off" : "Enable"}
      </button>
    </div>
  );
}
