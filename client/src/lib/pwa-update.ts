/**
 * "A new build is downloaded and parked" — as a fact two different controls can
 * read, and one routine both of them can act on.
 *
 * WHY IT LEFT `components/pwa/pwa-updater.tsx`. That component owns the service
 * worker registration, so it owned the `needRefresh` flag too, and the only way
 * to reach the update was the toast it renders. A toast is a moment: it is
 * dismissible, it is easy to miss on a second monitor, and once it is gone the
 * staged build sits there with no route to it until the next poll happens to
 * fire again. The rail's refresh control is permanent, so it can carry the same
 * signal without expiring — but only if the signal is not locked inside one
 * component's state. Hence a tiny store: `PwaUpdater` publishes into it, anyone
 * subscribes.
 *
 * The toast is unchanged and stays the primary announcement. This is the
 * SECOND route to the same action, not a replacement for the first.
 */
import * as React from "react";

let updateReady = false;
let applying = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Published by `PwaUpdater` from the service worker's `onNeedRefresh`. */
export function setUpdateReady(ready: boolean): void {
  if (updateReady === ready) return;
  updateReady = ready;
  emit();
}

export function isUpdateReady(): boolean {
  return updateReady;
}

export function isApplyingUpdate(): boolean {
  return applying;
}

/** A new build is staged and waiting to take over this tab. */
export function useUpdateReady(): boolean {
  return React.useSyncExternalStore(subscribe, isUpdateReady, isUpdateReady);
}

/** An apply is in flight — the reload is coming, so decline further clicks. */
export function useApplyingUpdate(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    isApplyingUpdate,
    isApplyingUpdate,
  );
}

/**
 * Apply the staged update.
 *
 * We drive this ourselves instead of calling vite-plugin-pwa's
 * `updateServiceWorker()`, because that path has two ways to do NOTHING AT ALL
 * on a click — both of which shipped as a dead button:
 *
 *   1. workbox-window's `messageSkipWaiting()` is
 *          if (this._registration && this._registration.waiting) { ...post... }
 *      — a silent no-op when `waiting` is null. No error, no reload, no
 *      feedback. Clicking again does nothing again, forever.
 *
 *   2. The reload itself is gated on `if (event.isUpdate)`, and `isUpdate` is
 *      latched ONCE at registration as `Boolean(navigator.serviceWorker
 *      .controller)`. A hard refresh (Ctrl+F5) BYPASSES the service worker, so
 *      the page loads uncontrolled, `controller` is null, `isUpdate` is false —
 *      and the reload line never runs. That is a trap with a latch:
 *      hard-refreshing to escape a stuck banner is exactly what guarantees the
 *      NEXT click is dead too.
 *
 * So: resolve the registration fresh (never a stale reference), talk to the
 * waiting worker directly, reload on `controllerchange` with no `isUpdate`
 * condition — and, above all, guarantee the call always ends in a reload. A
 * control that sometimes does nothing is the actual bug being fixed here.
 */
export function applyPendingUpdate(): void {
  if (applying) return;
  applying = true;
  emit();

  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  const sw = navigator.serviceWorker;
  if (!sw) {
    reload();
    return;
  }

  // The real path: the new worker activates, claims this tab (clientsClaim in
  // vite.config.ts is what makes it claim an UNCONTROLLED tab — the post-
  // Ctrl+F5 case above), and we reload the moment control changes hands.
  sw.addEventListener("controllerchange", reload, { once: true });

  // Backstop. If control never changes — no waiting worker, a worker wedged
  // mid-lifecycle, a browser that swallows the message — reload anyway rather
  // than leave the user pressing a control that does nothing. Worst case they
  // get the same version back and the toast returns; that is still strictly
  // better than silence.
  window.setTimeout(reload, 1500);

  sw.getRegistration()
    .then((reg) => {
      if (!reg) return reload();

      // Already installed and parked: tell it to take over now.
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }

      // Still downloading: skip waiting as soon as it finishes, so a user who
      // acts the instant the toast appears is not punished for being quick.
      const installing = reg.installing;
      if (installing) {
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed")
            installing.postMessage({ type: "SKIP_WAITING" });
        });
        return;
      }

      // Nothing waiting, nothing installing — the new build is already the
      // active worker and this tab is just running old code. A plain reload is
      // exactly the right move.
      reload();
    })
    .catch(() => reload());
}

/** Test seam: drop the module's state between cases. Not used by the app. */
export function __resetPwaUpdate(): void {
  updateReady = false;
  applying = false;
  listeners.clear();
}
