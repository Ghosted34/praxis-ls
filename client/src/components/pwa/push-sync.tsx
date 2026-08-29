/**
 * Mounted once at the app root: re-registers this device's push subscription on
 * every boot, and again whenever the service worker reports that the browser
 * rotated the subscription out from under us while a tab was open.
 *
 * The reasoning — why a subscription needs re-registering at all, and why the
 * service worker cannot do it itself — is in lib/push-sync.ts, which holds the
 * logic. This file is only the mount point.
 */
import * as React from "react";
import { syncPushSubscription } from "@/lib/push-sync";

export function PushSync() {
  React.useEffect(() => {
    let live = true;
    void syncPushSubscription();

    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string } | null;
      if (!live || !msg || msg.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
      // Re-read from the registration rather than trusting the posted copy:
      // whatever the worker ended up with is the truth, and it is one call away.
      void syncPushSubscription();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      live = false;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
