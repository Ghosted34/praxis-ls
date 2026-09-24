/**
 * The ring's client-side channels (calls audit PR-4).
 *
 * The ring push goes to every device of the callee at dial (a closed or hidden
 * app shows it; a visible one is handed it by the service worker). This is the
 * open tab's half:
 *
 *   tab visible     the in-app ring IS the ring; it acks `socket`.
 *   tab hidden      it also shows the ring notification itself, with the
 *                   same tag as the push (one notification, not two); it acks
 *                   `notification`.
 *   app opened
 *   from a push     the deep link rebuilds the ring; it acks `push`.
 *
 * The ack is the ring-channel metric only: it stops nothing on any device
 * (audit A12). Rings stop when the call is answered, declined or ends.
 *
 * Nothing here throws: a notification that fails must not lose the in-app
 * ring underneath it.
 */
import { tr, tv } from "@/lib/i18n";

export type RingChannel = "socket" | "notification" | "push";

type RingPresentation = {
  callId: string;
  peerName: string | null;
  /** When the 60-second window closes. Rendered into the notification so the
   *  shade does not promise a call that has already expired. */
  expiresAt?: string;
  recordingEnabled?: boolean;
};

/** The tag every ring notification shares, so a re-alert, the page's own
 *  notification and the cancel all REPLACE rather than stack (the server
 *  sets the same tag). */
export const ringTag = (callId: string) => `call:${callId}`;

/** The deep link a ring notification opens, and the one an action carries.
 *  `?ring=`, never `?call=`: that one is the summary link (audit A6). */
export function ringUrl(callId: string, action?: "accept" | "decline"): string {
  const q = new URLSearchParams({ ring: callId });
  if (action) q.set("act", action);
  return `/comms?${q.toString()}`;
}

function title(p: RingPresentation): string {
  return p.peerName
    ? tv("Incoming call from {{name}}", { name: p.peerName })
    : tr("Voice call");
}

/**
 * Show the ring notification from a hidden tab, preferring the service
 * worker (the only API with action buttons). Permission is never requested
 * here: a prompt raised by a ring gets a reflex "Block" (the one-time call
 * prompt and Settings → Calls ask instead). `new Notification()` is the
 * fallback where there is no registration. Returns true when one was shown.
 */
export async function showRingNotification(p: RingPresentation): Promise<boolean> {
  const body = p.recordingEnabled
    ? tr("This call is recorded and summarized — both parties are informed")
    : tr("Tap to answer");
  const options: NotificationOptions & {
    actions?: Array<{ action: string; title: string }>;
    renotify?: boolean;
    vibrate?: number[];
  } = {
    body,
    tag: ringTag(p.callId),
    requireInteraction: true,
    renotify: true,
    vibrate: [600, 250, 600, 250, 600],
    data: { url: ringUrl(p.callId), kind: "call_ring", call_id: p.callId, expires_at: p.expiresAt },
    actions: [
      { action: "accept", title: tr("Answer") },
      { action: "decline", title: tr("Decline") },
    ],
  };

  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.ready) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(title(p), options);
        return true;
      }
    }
  } catch {
    /* @silent:teardown — a registration that refuses falls through to the page
       notification; losing this tier must not lose the ring. */
  }

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title(p), { body, tag: ringTag(p.callId) });
      return true;
    }
  } catch {
    /* @silent:teardown — same: the in-app ring is the floor. */
  }
  // Nothing was shown: no ack, because this device did not present the ring.
  return false;
}

/** Take the notification down — on answer, on decline, on a terminal event. */
export async function dismissRingNotification(callId: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistrations) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      if (typeof reg.getNotifications !== "function") continue;
      const notes = await reg.getNotifications({ tag: ringTag(callId) });
      for (const n of notes) n.close();
    }
  } catch {
    /* @silent:teardown — closing a notification that is already gone is a
     * no-op, and there is nothing to repair. */
  }
}

/**
 * Present the ring on the best channel this tab has, and say which one it
 * was: a visible tab rings in-app, a hidden one also shows the notification.
 * `pageVisible` is injectable so the decision is testable without a DOM.
 */
export async function presentRing(
  p: RingPresentation,
  deps: { pageVisible?: () => boolean } = {},
): Promise<RingChannel | null> {
  const visible = deps.pageVisible ? deps.pageVisible() : typeof document !== "undefined" && !document.hidden;
  if (visible) return "socket";
  const shown = await showRingNotification(p);
  // null = nothing shown here; the push (sent to every device) still is.
  return shown ? "notification" : null;
}

const CALL_ID = /^[0-9a-f-]{36}$/i;

/**
 * Parse a RING deep link (`?ring=<id>[&act=…]`). Returns null for anything
 * else, `?call=` included: the app routes on this, and a false positive opens
 * a call screen (or a redial offer) out of nowhere (audit A6).
 */
export function parseCallLink(search: string): { callId: string; action: "accept" | "decline" | null } | null {
  try {
    const params = new URLSearchParams(search || "");
    const callId = params.get("ring");
    if (!callId || !CALL_ID.test(callId)) return null;
    const act = params.get("act");
    return { callId, action: act === "accept" || act === "decline" ? act : null };
  } catch {
    return null;
  }
}

/**
 * The old summary-notification link (`/comms?call=<id>`), still in people's
 * notification shades. It opens the call's summary page, never a ring.
 */
export function parseSummaryLink(search: string): string | null {
  try {
    const callId = new URLSearchParams(search || "").get("call");
    return callId && CALL_ID.test(callId) ? callId : null;
  } catch {
    return null;
  }
}
