/**
 * Single mount point for all the always-on PWA UI: the install banner, the
 * service-worker update/offline-ready toast, and the offline indicator. Rendered
 * once at the app root so it overlays every route (landing included).
 */
import { InstallBanner } from "./install-banner";
import { PwaUpdater } from "./pwa-updater";
import { OfflineIndicator } from "./offline-indicator";

export function PwaLayer() {
  return (
    <>
      <OfflineIndicator />
      <PwaUpdater />
      <InstallBanner />
    </>
  );
}
