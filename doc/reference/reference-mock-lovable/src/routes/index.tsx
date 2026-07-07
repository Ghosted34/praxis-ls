import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import styleCss from "../lib/dashboard/style.css.txt?raw";
import bodyHtml from "../lib/dashboard/body.html.txt?raw";
import scriptJs from "../lib/dashboard/script.js.txt?raw";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Reflect data-theme / data-mode on <html> for the dashboard CSS variables
    const htmlEl = document.documentElement;
    const prevTheme = htmlEl.getAttribute("data-theme");
    const prevMode = htmlEl.getAttribute("data-mode");
    htmlEl.setAttribute("data-theme", "light");
    htmlEl.setAttribute("data-mode", "live");

    // Inject styles once
    const styleTag = document.createElement("style");
    styleTag.setAttribute("data-slas-style", "");
    styleTag.textContent = styleCss;
    document.head.appendChild(styleTag);

    // Inject dashboard markup
    host.innerHTML = bodyHtml;

    // Run the imperative dashboard script
    const scriptTag = document.createElement("script");
    scriptTag.textContent = scriptJs;
    document.body.appendChild(scriptTag);

    return () => {
      document.head.removeChild(styleTag);
      document.body.removeChild(scriptTag);
      host.innerHTML = "";
      if (prevTheme) htmlEl.setAttribute("data-theme", prevTheme);
      else htmlEl.removeAttribute("data-theme");
      if (prevMode) htmlEl.setAttribute("data-mode", prevMode);
      else htmlEl.removeAttribute("data-mode");
    };
  }, []);

  return <div ref={hostRef} className="slas-root" />;
}
