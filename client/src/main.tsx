import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/app/auth/auth-context";
import { BrandingProvider } from "@/app/branding/branding-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { initThemeMode } from "@/lib/theme-mode";
import { installGlobalErrorReporting } from "@/lib/error-reporting";
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

// OBS-E2: window 'error' and 'unhandledrejection' — the two failure modes React
// never sees (event handlers, timers, un-awaited promises). Installed FIRST so a
// throw during module evaluation or boot is still captured; that is the case
// that produces a white screen with nothing in any log.
installGlobalErrorReporting();

// Apply the saved light/dark/system preference before first paint.
initThemeMode();

// BrandingProvider paints the tenant's white-label colour (default until the
// public /branding fetch resolves) and sits OUTSIDE auth so the login is branded
// pre-login. AuthProvider handles the session.
// QueryClientProvider wraps everything (audit F8): the shared server-state cache
// backing lib/use-resource. It sits outside BrandingProvider because the public
// /branding fetch is itself a candidate for caching.
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
