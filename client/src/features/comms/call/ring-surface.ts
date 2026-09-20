/**
 * The ring's client-side channels (Smart Comms PR-3, guide §4.6).
 *
 * The server escalates; this is what each DEVICE does when a ring reaches it,
 * and it exists because "the best channel" is a property of the device, not of
 * the call:
 *
 *   tab visible     the in-app ring IS the ring. It acknowledges on
 *                   `socket`, and the server's push escalation stands down.
 *   tab hidden      the service worker shows a real system notification —
 *                   with the Accept/Decline actions the shade renders, which
 *                   the page-level `new Notification()` cannot carry. It
 *                   acknowledges `notification`.
 *   app opened
 *   from a push     the deep link is followed into the app, which
 *                   acknowledges `push` once the accept screen is actually up.
 *
 * ── WHY THE ACK IS SENT FROM HERE AND NOT BY THE SERVER ─────────────────────
 *
 * "Which channel landed" is only knowable on the device that was rung — the
 * server knows which channel it SENT on, and sending is not landing (a push
 * with a dead subscription is sent and lands nowhere). The ack is the device's
 * evidence, which is why §7.4.4's distribution is built from it.
 *
 * ── AND WHY NOTHING HERE THROWS ─────────────────────────────────────────────
 *
 * Every branch can fail on a real phone: no service worker, notifications
 * denied, a browser that refuses `showNotification` outside a user gesture. A
 * ring that stops because the *notification* failed would be the worst of all
 * outcomes — so each surface is attempted, its failure swallowed, and the
 * in-app ring is always there underneath it. The ack is sent for whichever
 * surface actually succeeded.
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

/** The tag every ring notification shares, so a second escalation of the same
 *  ring REPLACES rather than stacks (the server sets it too; this is the
 *  client-side half of the same contract). */
export const ringTag = (callId: string) => `call:${callId}`;

/** The deep link a push opens, and the one an action carries. */
export function ringUrl(callId: string, action?: "accept" | "decline"): string {
  const q = new URLSearchParams({ call: callId });
  if (action) q.set("act", action);
  return `/comms?${q.toString()}`;
}

function title(p: RingPresentation): string {
  return p.peerName
    ? tv("Incoming call from {{name}}", { name: p.peerName })
    : tr("Voice call");
}

/**
 * Show the system notification, preferring the service worker.
 *
 * PERMISSION IS NOT REQUESTED HERE. A ring is a 60-second window and the
 * escalation clock is already running; a permission prompt raised by the ring
 * would block the ack that stops the push. The prompt belongs to a moment the
 * person chose (the call screen explains the tiers before it matters — PR-1's
 * flow already asks on first dial), and until it is answered the honest
 * behaviour is: tab visible → ring in-app; tab hidden → no ack, so the push
 * escalation at t=5 s still runs and the device's push is what reaches them.
 *
 * The service worker path is the one that matters: `registration.showNotification`
 * is the only API that renders ACTION BUTTONS, survives the tab being closed by
 * the user minutes later, and (on Android) puts the ring in the shade where a
 * call belongs. `new Notification()` is kept as the fallback for a browser
 * without a registration (or a dev origin without HTTPS, where there is no
 * service worker at all).
 *
 * Returns true when a notification was actually shown.
 */
export async function showRingNotification(p: RingPresentation): Promise<boolean> {
  const body = p.recordingEnabled
    ? tr("This call is recorded and summarized — both parties are informed")
    : tr("Tap to answer");
  const options: NotificationOptions & { actions?: Array<{ action: string; title: string }> } = {
    body,
    tag: ringTag(p.callId),
    requireInteraction: true,
    data: { url: ringUrl(p.callId), kind: "call", call_id: p.callId, expires_at: p.expiresAt },
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
  // Nothing was shown. THE CALLER MUST NOT ACK THIS: an ack is what stops the
  // push escalation, and a device that showed the user nothing has not heard
  // the bell (see the note above about permission).
  return false;
}

/** Take the notification down — on answer, on decline, on a terminal event, and
 *  when another device of the same user acknowledged the ring first. */
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
 * Present the ring on the best channel this device has, and say which one it
 * was.
 *
 * The precedence is the guide's matrix read from the device's side: a visible
 * tab rings in-app (the richest surface — it can be answered, declined and
 * shows the countdown), and only a hidden one reaches for the system
 * notification. `pageVisible` is injectable so that decision is testable
 * without a DOM.
 */
export async function presentRing(
  p: RingPresentation,
  deps: { pageVisible?: () => boolean } = {},
): Promise<RingChannel | null> {
  const visible = deps.pageVisible ? deps.pageVisible() : typeof document !== "undefined" && !document.hidden;
  if (visible) return "socket";
  const shown = await showRingNotification(p);
  // `null` = this device could not present the ring at all. The caller then
  // sends no ack, the server's push escalation fires at t=5 s, and if this
  // device has a working subscription the ring reaches it there — which is
  // precisely the tier the ack exists to protect.
  return shown ? "notification" : null;
}

/**
 * Parse a call deep link. Returns null for anything that is not one — the app
 * routes on this and a false positive would open a call screen out of nowhere.
 */
export function parseCallLink(search: string): { callId: string; action: "accept" | "decline" | null } | null {
  try {
    const params = new URLSearchParams(search || "");
    const callId = params.get("call");
    if (!callId || !/^[0-9a-f-]{36}$/i.test(callId)) return null;
    const act = params.get("act");
    return { callId, action: act === "accept" || act === "decline" ? act : null };
  } catch {
    return null;
  }
}
