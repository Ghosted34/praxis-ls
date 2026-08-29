/**
 * The unread count on the installed app's icon.
 *
 * ── WHY THE BADGE IS PART OF "DON'T MISS A MAIL" ────────────────────────────
 *
 * Every other channel is a moment: a banner shows and is gone, a sound plays
 * once, a push expires if the phone is off past its TTL. The badge is the only
 * one that is a STATE — it sits on the home screen until the thing is read. It
 * is what catches the notification that was swiped away half-asleep, or the one
 * that arrived while the phone was flat.
 *
 * ── WHY IT GOES THROUGH THE SERVICE WORKER TOO ──────────────────────────────
 *
 * `navigator.setAppBadge` from the page works while the page is open. Once the
 * app is closed, only the service worker can move the number — and the worker
 * sets it from the push payload (`badgeCount`, see public/push-handler.js). So
 * the two halves are: the page corrects the badge whenever the user reads
 * something, the worker advances it whenever a push arrives. Both are told
 * here so there is one place that knows the rule.
 *
 * Unsupported on some platforms (notably iOS Safari outside an installed
 * home-screen app, at the time of writing) and it can reject rather than throw.
 * Every path swallows: a wrong or missing badge must never surface as an error
 * in a product where the badge is a convenience and the notification is the
 * message.
 */

/** Last value we pushed, so repeated renders don't re-issue the same call. */
let lastApplied: number | null = null;

function supported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { setAppBadge?: unknown }).setAppBadge ===
      "function"
  );
}

/**
 * Set the app-icon badge to `count` (0 clears it).
 *
 * Fire-and-forget by design — callers are render paths and effects, and none of
 * them has anything useful to do with a failure.
 */
export function setAppBadge(count: number): void {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === lastApplied) return;
  lastApplied = n;

  if (supported()) {
    try {
      const nav = navigator as Navigator & {
        setAppBadge: (n?: number) => Promise<void>;
        clearAppBadge: () => Promise<void>;
      };
      const p = n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          /* @silent:teardown — the platform rejected the badge call (some
             builds reject rather than throw). The badge is a convenience; the
             notification itself is the message. */
        });
      }
    } catch {
      /* @silent:teardown — the badge API is present but refused. Nothing to
         recover: a wrong number on an app icon must never surface as an error
         in the product. */
    }
  }

  // Tell the worker as well. On some platforms the badge set from a page does
  // not persist once that page closes, and the worker's does; on others this is
  // a harmless duplicate. Sending both is cheaper than detecting which is which.
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      void navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage({ type: "SET_APP_BADGE", count: n });
        })
        .catch(() => {
          /* @silent:teardown — no service worker took control (a plain browser
             tab, or one whose registration was torn down). The page-side call
             above has already done what it can. */
        });
    }
  } catch {
    /* @silent:teardown — no service worker container in this context at all. */
  }
}

/** Testing seam — forget the memo so the next call always issues. */
export function resetAppBadgeMemo(): void {
  lastApplied = null;
}
