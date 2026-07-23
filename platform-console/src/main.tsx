import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "@/App";
import { ToastProvider } from "@/components/Toast";
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
