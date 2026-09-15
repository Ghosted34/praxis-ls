/**
 * Single mount point for all the always-on PWA UI: the install banner, the
 * service-worker update/offline-ready toast, the offline indicator, and the
 * push-subscription sync. Rendered once at the app root so it overlays every
 * route (landing included).
 */
import { InstallBanner } from "./install-banner";
import { PwaUpdater } from "./pwa-updater";
import { OfflineIndicator } from "./offline-indicator";
import { PushSync } from "./push-sync";
import { PushEnrolmentBanner } from "./push-enrolment-banner";
import { ConnectionWatcher } from "@/components/connection/connection-watcher";

export function PwaLayer() {
  return (
    <>
      {/* First: it installs the connection monitor and the outbox replay, which
          `OfflineIndicator` below then reads. Both installers are idempotent, so
          the order is for legibility rather than correctness. */}
      <ConnectionWatcher />
      <OfflineIndicator />
      <PwaUpdater />
      <InstallBanner />
      {/* Re-registers this device's push subscription on every boot. A
          subscription the browser silently rotated is a phone that has stopped
          receiving notifications with nothing, anywhere, reporting it. */}
      <PushSync />
      {/* Asks once, on a deliberate click, for the permission that makes every
          other part of the notification pipeline able to reach a person who is
          not looking at the app. Renders nothing unless there is something to
          fix — see the file header for why it is never an unbidden prompt. */}
      <PushEnrolmentBanner />
    </>
  );
}
