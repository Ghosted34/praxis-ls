/**
 * Keeping this device's push subscription registered with the server — for the
 * whole life of the install, not just the moment the user first opted in.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ──────────────────────────────────────
 *
 * A PushSubscription is not permanent. The browser replaces it on its own
 * schedule — a push service rotating keys, an endpoint expiring, a long idle
 * period, a browser data clear that leaves the permission granted. When that
 * happens the old endpoint stops working, and NOTHING reports it: the server
 * keeps sending to a dead endpoint, the phone keeps not receiving, and neither
 * side sees an error. The user simply stops getting notifications and has no
 * way to find out.
 *
 * The service worker hears `pushsubscriptionchange` and re-subscribes the
 * browser (public/push-handler.js), but it cannot tell the SERVER: registering
 * is an authenticated call and a worker holds no session — the access token
 * lives in the page. So the page does it, on every boot, from the component in
 * components/pwa/push-sync.tsx.
 */
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

export const pushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** The endpoint is the conflict key server-side, so this is an idempotent upsert. */
async function register(sub: PushSubscription): Promise<void> {
  await tenant("/notifications/push/subscribe", {
    method: "POST",
    body: { subscription: sub.toJSON() },
  });
}

export type PushSyncOutcome = "synced" | "resubscribed" | "skipped";

/**
 * Re-register this device, re-subscribing first if the browser lost the
 * subscription.
 *
 *   - permission granted + a subscription exists → re-POST it. One cheap,
 *     idempotent request per session, and it is what repairs a rotation.
 *   - permission granted + NO subscription (the browser dropped it and the
 *     worker could not re-create it) → subscribe again silently. The user
 *     already granted permission; making them hunt for the Settings toggle a
 *     second time is how a device goes quiet for good.
 *   - permission not granted → do nothing at all. This never prompts: asking
 *     for notification permission unbidden is what gets a site blocked for ever.
 *
 * Resolves on every failure — it runs on app boot and must never be able to
 * break it.
 */
export async function syncPushSubscription(): Promise<PushSyncOutcome> {
  if (!pushSupported()) return "skipped";
  if (Notification.permission !== "granted") return "skipped";
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await register(existing);
      return "synced";
    }
    // Permission is granted but the subscription is gone. Re-create it.
    const { public_key } = await tenant<{ public_key: string | null }>(
      "/notifications/push/public-key",
    );
    if (!public_key) return "skipped";
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
    await register(sub);
    return "resubscribed";
  } catch {
    /* @silent:storage — persisting this device's subscription failed (offline,
       an expired token, VAPID unset). All of them are recoverable on the next
       boot, and none is worth surfacing to somebody who just opened the app. */
    return "skipped";
  }
}
