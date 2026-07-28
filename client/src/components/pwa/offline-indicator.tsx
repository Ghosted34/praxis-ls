/**
 * Offline indicator. The service worker serves the cached app shell for
 * navigations while offline (workbox navigateFallback → index.html), so the SPA
 * still loads; API reads simply fail and screens fall back to their empty/error
 * states. This pill makes the offline condition explicit so those failures read
 * as "you're offline" rather than "something broke". (Offline read-only DATA is
 * intentionally out of scope for v1 — app-shell-offline only.)
 */
import * as React from "react";

export function OfflineIndicator() {
  const [offline, setOffline] = React.useState(typeof navigator !== "undefined" && !navigator.onLine);

  React.useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[65] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
      <div className="pointer-events-none flex items-center gap-2 rounded-full border bg-popover px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground shadow-m">
        <span className="h-2 w-2 rounded-full bg-[rgb(var(--warn))]" aria-hidden />
        You're offline — some data may be out of date.
      </div>
    </div>
  );
}
