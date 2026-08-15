/**
 * Service-worker lifecycle UI. We register the SW here (registerType is "prompt"
 * in vite.config, injectRegister:false) so we control the update experience:
 *   - onNeedRefresh → a "New version available" toast with a Reload action; the
 *     new build is already downloaded, Reload just activates it.
 *   - onOfflineReady → a brief "Ready to work offline" confirmation.
 * Using the React hook from vite-plugin-pwa's virtual module keeps this in sync
 * with the generated Workbox SW.
 */
import * as React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { XIcon } from "@/components/ui/icons";
import { useBranding } from "@/app/branding/branding-context";

/**
 * How often to ask the service worker to check for a new build.
 *
 * WHY WE POLL AT ALL. `registerType: "prompt"` fires `onNeedRefresh` only when
 * a new SW is DETECTED — and by default vite-plugin-pwa never proactively
 * asks. Chrome checks the sw.js file on tab navigation and on the browser's
 * own ~24 h cache TTL, so a user with a long-lived tab (the common ERP shape:
 * an operator leaves a dossier open all day) can sit on a stale bundle for
 * hours after a deploy, never seeing the "New version available" toast.
 *
 * Five minutes is short enough that a deploy is visible within one coffee
 * break, long enough that the polling cost is trivial (one HEAD-ish request
 * per user per five minutes). We also poll on tab-visible, so returning to a
 * tab that has been in the background immediately checks — the audit's
 * "leave a dossier open on one monitor for hours" note again.
 */
const SW_UPDATE_POLL_MS = 5 * 60_000;

export function PwaUpdater() {
  // Tenant-authored copy (Settings › App & PWA › Offline & updates), falling
  // back to the built-in strings. Only the wording is configurable — WHEN the
  // toast appears is the service worker's business, not a design choice.
  const { pwa } = useBranding();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    // Poll for updates so a long-open tab actually sees a new deploy. `r` is
    // the ServiceWorkerRegistration from the registration call — `update()`
    // asks the browser to re-fetch sw.js and, if the byte-stream differs, fire
    // the update lifecycle so `onNeedRefresh` above resolves.
    onRegisteredSW(_url, r) {
      if (!r) return;

      // In-flight guard + floor between checks.
      //
      // `tick` also runs on EVERY visibilitychange, so alt-tabbing fired an
      // update() per focus — overlapping calls against one registration, which
      // is one of the ways it lands in an invalid state to begin with.
      let checking = false;
      let lastCheck = 0;
      const MIN_GAP_MS = 30_000;

      const tick = () => {
        // Don't check while offline — `update()` would just fail; wait for
        // the next visibility change or the next scheduled tick.
        if (navigator.onLine === false) return;
        if (checking || Date.now() - lastCheck < MIN_GAP_MS) return;

        checking = true;
        lastCheck = Date.now();

        // `.catch()`, NOT `void`.
        //
        // `update()` REJECTS — `InvalidStateError: Failed to update a
        // ServiceWorker … The object is in an invalid state` — whenever the
        // registration is no longer usable: it has been superseded, the user
        // cleared site data, or a previous update is mid-lifecycle. A floating
        // promise made every one of those an UNHANDLED REJECTION, which
        // window.onunhandledrejection dutifully reported as an application
        // error. It reached ×7 in a day and none of it was a fault: a failed
        // update CHECK is benign by construction, because the next tick simply
        // tries again.
        r.update()
          .catch(() => {
            /* benign — the app is fine, the next tick retries */
          })
          .finally(() => {
            checking = false;
          });
      };

      const timer = window.setInterval(tick, SW_UPDATE_POLL_MS);
      const onVisibility = () => {
        if (document.visibilityState === "visible") tick();
      };
      document.addEventListener("visibilitychange", onVisibility);
      // Nothing tears this down: the SW registration is per-page and lives as
      // long as the page does. The intent IS to keep polling for the lifetime
      // of the tab — an unmount cleanup here would defeat the point.
      void timer;
      void onVisibility;
    },
    onRegisterError(err) {
      // Non-fatal: the app works without the SW, just without offline/install.

      console.warn("[pwa] service worker registration failed", err);
    },
  });

  // Auto-hide the "ready to work offline" note after a few seconds.
  React.useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 5000);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  const [applying, setApplying] = React.useState(false);

  /**
   * Apply the update. We drive this ourselves instead of calling the plugin's
   * `updateServiceWorker()`, because that path has two ways to do NOTHING AT
   * ALL on a click — both of which shipped as a dead button:
   *
   *   1. workbox-window's `messageSkipWaiting()` is
   *          if (this._registration && this._registration.waiting) { ...post... }
   *      — a silent no-op when `waiting` is null. No error, no reload, no
   *      feedback. Clicking again does nothing again, forever.
   *
   *   2. The reload itself is gated on `if (event.isUpdate)`, and `isUpdate` is
   *      latched ONCE at registration as `Boolean(navigator.serviceWorker
   *      .controller)`. A hard refresh (Ctrl+F5) BYPASSES the service worker,
   *      so the page loads uncontrolled, `controller` is null, `isUpdate` is
   *      false — and the reload line never runs. That is a trap with a latch:
   *      hard-refreshing to escape a stuck banner is exactly what guarantees
   *      the NEXT click is dead too.
   *
   * So: resolve the registration fresh (never a stale reference), talk to the
   * waiting worker directly, reload on `controllerchange` with no `isUpdate`
   * condition — and, above all, guarantee the click always ends in a reload.
   * A button that sometimes does nothing is the actual bug being fixed here.
   */
  const applyUpdate = React.useCallback(() => {
    if (applying) return;
    setApplying(true);

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
    // than leave the user clicking a button that does nothing. Worst case they
    // get the same version back and the banner returns; that is still strictly
    // better than silence, which is what they have today.
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
        // clicks the instant the toast appears is not punished for being quick.
        const installing = reg.installing;
        if (installing) {
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed")
              installing.postMessage({ type: "SKIP_WAITING" });
          });
          return;
        }

        // Nothing waiting, nothing installing — the new build is already the
        // active worker and this tab is just running old code. A plain reload
        // is exactly the right move.
        reload();
      })
      .catch(() => reload());
  }, [applying]);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border bg-popover p-3 pl-4 shadow-l">
        <div className="min-w-0 flex-1">
          {needRefresh ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                {pwa.updateTitle || "New version available"}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {pwa.updateBody || "Reload to get the latest update."}
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-foreground">
              {pwa.offlineReadyText || "Ready to work offline."}
            </p>
          )}
        </div>
        {needRefresh && (
          <button
            type="button"
            onClick={applyUpdate}
            disabled={applying}
            className="flex-none rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {applying ? "Updating…" : pwa.updateButton || "Reload"}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            setNeedRefresh(false);
            setOfflineReady(false);
          }}
          className="flex-none rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
