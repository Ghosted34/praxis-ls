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

export function PwaUpdater() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      // Non-fatal: the app works without the SW, just without offline/install.
      // eslint-disable-next-line no-console
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
              <p className="text-sm font-semibold text-foreground">New version available</p>
              <p className="text-[13px] text-muted-foreground">Reload to get the latest update.</p>
            </>
          ) : (
            <p className="text-sm font-medium text-foreground">Ready to work offline.</p>
          )}
        </div>
        {needRefresh && (
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="flex-none rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Reload
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
