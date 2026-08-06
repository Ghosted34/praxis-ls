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
    updateServiceWorker,
  } = useRegisterSW({
    // Poll for updates so a long-open tab actually sees a new deploy. `r` is
    // the ServiceWorkerRegistration from the registration call — `update()`
    // asks the browser to re-fetch sw.js and, if the byte-stream differs, fire
    // the update lifecycle so `onNeedRefresh` above resolves.
    onRegisteredSW(_url, r) {
      if (!r) return;
      const tick = () => {
        // Don't check while offline — `update()` would just fail; wait for
        // the next visibility change or the next scheduled tick.
        if (navigator.onLine === false) return;
        void r.update();
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

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border bg-popover p-3 pl-4 shadow-l">
        <div className="min-w-0 flex-1">
          {needRefresh ? (
            <>
              <p className="text-sm font-semibold text-foreground">{pwa.updateTitle || "New version available"}</p>
              <p className="text-[13px] text-muted-foreground">{pwa.updateBody || "Reload to get the latest update."}</p>
            </>
          ) : (
            <p className="text-sm font-medium text-foreground">{pwa.offlineReadyText || "Ready to work offline."}</p>
          )}
        </div>
        {needRefresh && (
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="flex-none rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {pwa.updateButton || "Reload"}
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
