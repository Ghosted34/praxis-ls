/**
 * Service-worker lifecycle UI. We register the SW here (registerType is "prompt"
 * in vite.config, injectRegister:false) so we control the update experience:
 *   - a new build → a "New version available" toast with a Reload action.
 *     Reload activates it — and, if it is still downloading, waits for it.
 *   - onOfflineReady → a brief "Ready to work offline" confirmation.
 * Using the React hook from vite-plugin-pwa's virtual module keeps this in sync
 * with the generated Workbox SW.
 *
 * WHEN the toast appears is decided in `lib/pwa-update.ts`, not here: the
 * plugin's `onNeedRefresh` reports into that store, and so does a direct watch
 * on the registration, which catches the builds the plugin misses on a phone
 * (the file header there has the whole account).
 */
import * as React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { XIcon } from "@/components/ui/icons";
import { useBranding } from "@/app/branding/branding-context";
import {
  applyPendingUpdate,
  checkForUpdate,
  dismissUpdate,
  reportStagedBuild,
  startUpdateWatch,
  useApplyingUpdate,
  useUpdateReady,
  watchRegistration,
} from "@/lib/pwa-update";

export function PwaUpdater() {
  // Tenant-authored copy (Settings › App & PWA › Offline & updates), falling
  // back to the built-in strings. Only the wording is configurable — WHEN the
  // toast appears is the service worker's business, not a design choice.
  const { pwa } = useBranding();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    // `r` is the ServiceWorkerRegistration from the registration call. The
    // store watches it for the life of the page and checks it now; the
    // polling, the in-flight guard and the checks on resume all live there
    // (`startUpdateWatch`), because a phone needs them from the first frame —
    // not from whenever the workbox-window chunk finishes downloading.
    onRegisteredSW(_url, r) {
      if (!r) return;
      watchRegistration(r);
      void checkForUpdate();
    },
    onRegisterError(err) {
      // Non-fatal: the app works without the SW, just without offline/install.

      console.warn("[pwa] service worker registration failed", err);
    },
  });

  // Look for a staged build as soon as this mounts, and keep looking whenever
  // the app comes back into view. Nothing tears this down in the app — the
  // intent IS to keep watching for the lifetime of the tab — but the stop
  // function keeps a remount from stacking a second set of listeners.
  React.useEffect(() => startUpdateWatch(), []);

  // Auto-hide the "ready to work offline" note after a few seconds.
  React.useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 5000);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  /*
   * The plugin's "a build is waiting" goes into the store, so it outlives this
   * toast.
   *
   * The toast is a moment — dismissible, easy to miss on a second monitor, and
   * once it is gone the downloaded build sits there with no route to it until
   * the next poll happens to fire. The rail's refresh control is permanent and
   * carries the same signal as a dot, so a user who dismissed the toast (or
   * never saw it) can still find the update. See `lib/pwa-update.ts`.
   *
   * The DISMISS button below clears the store, which clears the dot too —
   * correct: dismissing is the user saying "not now", and a badge that
   * survives being dismissed is a badge that cannot be dismissed. It stays
   * dismissed for THAT build; a newer deploy asks again.
   */
  React.useEffect(() => {
    if (needRefresh) reportStagedBuild();
  }, [needRefresh]);
  const updateReady = useUpdateReady();

  // The apply routine itself now lives in `lib/pwa-update.ts` — unchanged, and
  // with the whole account of why it does not call the plugin's
  // `updateServiceWorker()`. It moved so the rail's "Reload into new version"
  // and this button run the identical code path; two implementations of a
  // service-worker handover is two sets of the bugs that comment describes.
  const applying = useApplyingUpdate();

  if (!updateReady && !offlineReady) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border bg-popover p-3 pl-4 shadow-l">
        <div className="min-w-0 flex-1">
          {updateReady ? (
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
        {updateReady && (
          <button
            type="button"
            onClick={applyPendingUpdate}
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
            dismissUpdate();
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
