import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/app/auth/auth-context";
import { BrandingProvider } from "@/app/branding/branding-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { initThemeMode } from "@/lib/theme-mode";
import { queryClient } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "@/app/app";
// Self-hosted variable Inter. Imported here (not via a CDN <link> in index.html)
// so Vite emits the woff2 into dist/assets, where the service worker's
// `**/*.woff2` precache glob picks it up — the app keeps its typography
// offline, which the Google-Fonts link could not do (audit F17).
import "@fontsource-variable/inter";
import "./index.css";

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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <BrandingProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrandingProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
