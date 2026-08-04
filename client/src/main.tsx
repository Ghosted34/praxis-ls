import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/app/auth/auth-context";
import { BrandingProvider } from "@/app/branding/branding-context";
import { initThemeMode } from "@/lib/theme-mode";
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
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <BrandingProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrandingProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
