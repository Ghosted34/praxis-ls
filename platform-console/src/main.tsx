import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "@/App";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/error-reporting";
// Self-hosted, from the same library the tenant app ships (client/src/lib/fonts.ts).
// styles.css named Montserrat for years without anything bundling it, so the
// console rendered in the OS default. Static imports, not lazy: this app has no
// font picker — one sans, one mono, both always in use.
import "@fontsource-variable/montserrat";
import "@fontsource-variable/jetbrains-mono";
import "@/styles.css";

// doc/ERROR_HANDLING.md §7 — the console had ZERO error reporting before
// this. If the console broke, the error monitor it RENDERS could not tell
// you. Same two listeners as the tenant app, installed FIRST so a throw
// during module evaluation still lands here. Every report is tagged
// `surface: "platform-console"` so a console bug is filterable apart from
// a tenant-app bug.
installGlobalErrorReporting();

// HashRouter (not BrowserRouter): the console is served as a static bundle at the
// admin host root with no server-side SPA fallback for deep paths, so hash routing
// keeps every route resolvable without extra nginx/Express config.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outermost boundary: a render throw anywhere below used to blank the
        whole console. The boundary catches it, reports as fatal to the
        error monitor, and shows a recoverable fallback with a "Try again"
        that clears the error state without a full reload. */}
    <ErrorBoundary name="Platform console">
      <HashRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
