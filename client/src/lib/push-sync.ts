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
import { saveRotationToken } from "@/lib/push-token-store";

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

/**
 * The endpoint is the conflict key server-side, so this is an idempotent upsert.
 *
 * The response carries a fresh single-use ROTATION TOKEN, which goes into
 * IndexedDB where the service worker can read it. That is what lets a device
 * repair itself the moment the browser rotates its subscription, instead of
 * waiting for the user to next open an app that has stopped notifying them.
 */
async function register(sub: PushSubscription): Promise<void> {
  const res = await tenant<{ rotation_token?: string | null }>(
    "/notifications/push/subscribe",
    { method: "POST", body: { subscription: sub.toJSON() } },
  );
  if (res && res.rotation_token) await saveRotationToken(res.rotation_token);
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
/**
 * Was this subscription minted with the key the server is signing with now?
 *
 * ── THE FAILURE THIS ANSWERS ────────────────────────────────────────────────
 *
 * A PushSubscription is bound to ONE application server key. Rotating the
 * deploy's VAPID pair — one button in the Platform Console, and the obvious
 * first thing to try when push "isn't working" — makes every subscription in
 * every tenant undeliverable in the same instant. The push services reject the
 * signature with 403, NOT with 404/410, so the server prunes nothing and the
 * device count stays reassuringly non-zero.
 *
 * And this function's absence is what made that permanent. The sync below
 * re-POSTs whatever the browser is holding; without asking which key it was
 * minted under, it faithfully re-registered a dead subscription on every boot,
 * for ever. The repair mechanism was keeping the breakage alive.
 */
function mintedWith(sub: PushSubscription, publicKey: string): boolean {
  const held = sub.options?.applicationServerKey;
  // Both unknowns answer TRUE — "leave this subscription alone".
  //
  // A browser that does not expose `options.applicationServerKey`, or a server
  // that answered with a key we cannot decode, tells us nothing about whether
  // this device is current. Guessing "stale" there would unsubscribe and
  // re-mint on EVERY boot: a new endpoint each time, the previous one deleted,
  // permanent churn — for devices that were probably fine. The server-side
  // 403 handling still catches a genuinely superseded subscription; it just
  // takes one failed send to do it instead of none.
  if (!held) return true;
  let b: Uint8Array;
  try {
    b = urlBase64ToUint8Array(publicKey);
  } catch {
    return true;
  }
  const a = new Uint8Array(held);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Drop a subscription both locally and server-side.
 *
 * Both halves are best-effort on purpose: this runs on the way to minting a
 * REPLACEMENT, and the replacement is what the user needs. A failed DELETE
 * leaves one stale row that the next send prunes anyway, and a browser that
 * refuses `unsubscribe()` still lets `subscribe()` supersede it.
 */
async function discard(sub: PushSubscription): Promise<void> {
  await tenant("/notifications/push/subscribe", {
    method: "DELETE",
    body: { endpoint: sub.endpoint },
  }).catch(() => {
    /* @silent:storage — the row survives; the next send prunes it. */
  });
  await sub.unsubscribe().catch(() => {
    /* @silent:teardown — subscribing again supersedes it regardless. */
  });
}

export async function syncPushSubscription(): Promise<PushSyncOutcome> {
  if (!pushSupported()) return "skipped";
  if (Notification.permission !== "granted") return "skipped";
  try {
    const reg = await navigator.serviceWorker.ready;
    let existing = await reg.pushManager.getSubscription();

    // Ask for the current key FIRST, so an existing subscription can be checked
    // against it rather than re-registered on faith. One cheap authenticated GET
    // per boot, on a path that already made one.
    const { public_key } = await tenant<{ public_key: string | null }>(
      "/notifications/push/public-key",
    );
    if (!public_key) return "skipped"; // push not configured on this deployment

    if (existing && !mintedWith(existing, public_key)) {
      // Superseded. Nothing will ever arrive on it again, so replacing it is
      // the repair — and dropping the server row too keeps the device count
      // honest in the moment between the two calls.
      await discard(existing);
      existing = null;
    }

    if (existing) {
      await register(existing);
      return "synced";
    }
    // Permission is granted but the subscription is gone (or was superseded).
    // Re-create it.
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

/**
 * How many devices the server can actually reach this user on.
 *
 * `0` while `Notification.permission === "granted"` is the shape of the silent
 * failure this whole file exists for: the browser looks subscribed, the toggle
 * reads "on", and every registered endpoint has been pruned as gone. Returns
 * null when the question could not be asked.
 */
export async function countRegisteredDevices(): Promise<number | null> {
  try {
    const { devices } = await tenant<{ devices: number }>("/notifications/push/devices");
    return typeof devices === "number" ? devices : null;
  } catch {
    /* @silent:storage — offline or unauthenticated; the caller shows nothing */
    return null;
  }
}

/** What a self-test actually did. Mirrors sendToUser's result. */
export interface PushTestResult {
  ok: boolean;
  sent: number;
  failed: number;
  pruned: number;
  stale?: number;
  total: number;
  devices: number | null;
  reason?: string;
}

/**
 * Send a real push to this user's own devices and report what happened.
 *
 * Re-syncs first, deliberately. The commonest reason a test would fail is the
 * one above — a subscription minted under a key the server has rotated away
 * from — and that is repairable here and now, so the button repairs it and
 * then proves the repair rather than reporting a fault the user cannot act on.
 */
export async function sendPushTest(): Promise<PushTestResult> {
  await syncPushSubscription();
  return tenant<PushTestResult>("/notifications/push/test", { method: "POST" });
}

/**
 * The one sentence to show somebody whose test did not arrive. Deliberately
 * says what to DO — a reason the user cannot act on is the same as silence,
 * which is the state this whole feature exists to end.
 */
export function explainPushFailure(r: PushTestResult): string {
  if (r.reason === "push not configured") {
    return "Push delivery isn't set up on this deployment yet. Your administrator needs to generate a VAPID keypair in the Platform Console.";
  }
  if (r.reason === "no push_subscription table") {
    return "This workspace is missing the push tables. Your administrator needs to run the outstanding database migrations.";
  }
  if (r.reason === "devices registered under a superseded key") {
    return "This device was registered against an older signing key and has been reconnected. Send the test again.";
  }
  if (r.reason === "no registered devices" || r.devices === 0) {
    return "No device is registered for your account. Turn notifications on above — on iPhone, install the app to the Home Screen first.";
  }
  if (r.failed > 0) {
    return "Your device is registered, but the push service refused the message. If it keeps happening, your administrator can check the notification logs.";
  }
  return "Nothing was sent. Turn notifications off and on again on this device.";
}
