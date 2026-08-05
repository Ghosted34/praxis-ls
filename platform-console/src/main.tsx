import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "@/App";
import { ToastProvider } from "@/components/Toast";
// Self-hosted, from the same library the tenant app ships (client/src/lib/fonts.ts).
// styles.css named Montserrat for years without anything bundling it, so the
// console rendered in the OS default. Static imports, not lazy: this app has no
// font picker — one sans, one mono, both always in use.
import "@fontsource-variable/montserrat";
import "@fontsource-variable/jetbrains-mono";
import "@/styles.css";

// HashRouter (not BrowserRouter): the console is served as a static bundle at the
// admin host root with no server-side SPA fallback for deep paths, so hash routing
// keeps every route resolvable without extra nginx/Express config.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);
