import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/app/auth/auth-context";
import { BrandingProvider } from "@/app/branding/branding-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { initThemeMode } from "@/lib/theme-mode";
import { initDensity } from "@/lib/density";
import { queryClient } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { App } from "@/app/app";
// Self-hosted variable Inter. Imported here (not via a CDN <link> in index.html)
// so Vite emits the woff2 into dist/assets, where the service worker's
// `**/*.woff2` precache glob picks it up — the app keeps its typography
// offline, which the Google-Fonts link could not do (audit F17).
import "@fontsource-variable/inter";
import "./index.css";
import { clearChunkReloadFlag } from "@/lib/chunk-reload";

// Apply the saved light/dark/system preference before first paint.
initThemeMode();

/**
 * Colour the pre-boot title bar (index.html) from the last session, before
 * anything is fetched.
 *
 * The bar's real colour comes from the tenant's App & PWA settings, which
 * arrive over the network — so the first frame of a cold start would otherwise
 * paint the light-theme fallback regardless of what the workspace actually
 * looks like. On a dark-themed tenant that is a white flash across the top of
 * the window, in the very first thing anyone sees of the app.
 *
 * Runs after initThemeMode() so `.dark` is already decided. If nothing is
 * cached (first ever launch, or private mode) the inline fallback stands, which
 * is the honest outcome rather than a guess.
 */
try {
  const cached = localStorage.getItem(
    `praxis.titlebar.${document.documentElement.classList.contains("dark") ? "dark" : "light"}`,
  );
  if (cached) document.documentElement.style.setProperty("--titlebar-bg", cached);
} catch {
  /* private mode — keep the inline fallback */
}
// Same, for row density. Both write an attribute on <html> rather than render
// anything, so doing it here — before createRoot — means the first paint is
// already correct instead of flashing the default and correcting itself.
initDensity();

// BrandingProvider paints the tenant's white-label colour (default until the
// public /branding fetch resolves) and sits OUTSIDE auth so the login is branded
// pre-login. AuthProvider handles the session.
// QueryClientProvider wraps everything (audit F8): the shared server-state cache
// backing lib/use-resource. It sits outside BrandingProvider because the public
// /branding fetch is itself a candidate for caching.
// The pre-boot bar has done its job the moment the shell can draw its own.
// Removed rather than hidden so assistive technology never finds two title bars.
document.getElementById("pre-boot-titlebar")?.remove();

// The app is loading, so whatever stale build a previous session recovered from
// is behind us. Cleared here rather than inside the recovery itself: leaving the
// flag set would mean the NEXT deploy's stale chunk goes straight to the error
// screen, having "already retried" in a session that succeeded hours ago.
clearChunkReloadFlag();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Outermost: a render throw anywhere below used to blank the whole SPA —
        white page, no message, and any unsaved form gone (F12). */}
    <ErrorBoundary name="Praxis LS">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TooltipProvider>
            {/* v7_startTransition: routes are lazy (app/app.tsx), and without
                this every navigation would unmount the current screen and paint
                the Suspense skeleton while the next chunk downloads. Routing
                inside a transition instead keeps the screen you are on until the
                new one is ready — so a cached chunk navigates with no visible
                loading state at all. */}
            <BrowserRouter future={{ v7_startTransition: true }}>
              <BrandingProvider>
                <AuthProvider>
                  <App />
                </AuthProvider>
              </BrandingProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
