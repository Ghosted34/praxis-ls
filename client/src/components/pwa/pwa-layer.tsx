/**
 * Single mount point for all the always-on PWA UI: the install banner, the
 * service-worker update/offline-ready toast, and the offline indicator. Rendered
 * once at the app root so it overlays every route (landing included).
 */
import { InstallBanner } from "./install-banner";
import { PwaUpdater } from "./pwa-updater";
import { OfflineIndicator } from "./offline-indicator";
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
    </>
  );
}
