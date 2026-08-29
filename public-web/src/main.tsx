import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Imported for its side effect BEFORE anything renders: the language is decided
// from `?lang=` → saved choice → browser, and a page that paints English first
// and then flips to French is a page that showed the wrong site.
import "@/lib/i18n";
import { useLang } from "@/lib/i18n";
import { initThemeMode } from "@/lib/theme-mode";
import { BrandingProvider } from "@/app/branding";
import { AppErrorBoundary } from "@/app/error-boundary";
import { AppRouter } from "@/app/router";
// Self-hosted variable faces, imported here rather than linked from a CDN so
// Vite emits the woff2 into `dist/assets` and the font files are served from the
// tenant's own origin. A stranger reading a quote form should not be making a
// third-party request to do it, and `scripts/check-fonts.mjs` fails a build whose
// stacks do not end in a generic family — the brand sheet's fallback rule.
import "@fontsource-variable/inter";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// The `.dark` class and `data-theme` are already on `<html>` before first paint —
// the inline script in `index.html` writes them, and this file is a deferred
// module, so anything set here happens after the body has painted. Called anyway:
// it is idempotent, and it is the place where a future "system" mode would wire
// its listener.
initThemeMode();

/**
 * One `useLang()` at the root, and that is the whole translation subscription.
 *
 * Most copy here goes through `useTranslation()`, which subscribes by itself. The
 * exceptions are the portals' `tr()` calls — a status token sentence-cased and
 * looked up through the global i18next instance, with no hook to hang a
 * subscription on — which is exactly how a page ends up half in French: the
 * headings re-render, the pills do not. A re-render at the root covers every
 * component that uses the hook-free helper, so the alternative (threading
 * `useTranslation` through ~40 ported components) is not worth the diff.
 */
function Root() {
  useLang();
  return (
    <React.StrictMode>
      <AppErrorBoundary>
        <BrandingProvider>
          {/* `future.v7_startTransition`, as in `client`: routes are lazy, and
              without this every navigation unmounts the current screen and paints
              the skeleton while the next chunk downloads. Inside a transition the
              reader keeps the page they have until the new one is ready. */}
          <BrowserRouter future={{ v7_startTransition: true }}>
            <AppRouter />
          </BrowserRouter>
        </BrandingProvider>
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("public-web: #root is missing from index.html");

ReactDOM.createRoot(container).render(<Root />);
