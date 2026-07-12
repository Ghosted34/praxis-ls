/**
 * Control Tower home — the full Lovable mock (doc/reference/reference-mock-lovable).
 * The mock is a self-contained static HTML/CSS/JS dashboard whose CSS uses global
 * selectors (`*{margin:0}`, `body{overflow:hidden}`) that would clobber the app
 * shell, so we render it inside an isolated <iframe srcDoc> — pixel-perfect and
 * style-sandboxed, it cannot break anything outside the frame. Theme is synced
 * from the app's light/dark state at mount.
 */
import * as React from "react";
import bodyHtml from "./dashboard-mock/body.html.txt?raw";
import styleCss from "./dashboard-mock/style.css.txt?raw";
import scriptJs from "./dashboard-mock/script.js.txt?raw";

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600;700;800&display=swap">`;

// The mock ships its own full top command bar (brand + nav + search + live/test +
// avatar). We already render that chrome in the real app shell, so hide the mock's
// duplicate to leave a single, coherent header — the iframe then shows only the
// dashboard body (map, live shipments, KPIs). data-theme tracks the app's mode.
const OVERRIDES = `.topbar{display:none!important}`;

function buildDoc(theme: "light" | "dark"): string {
  return (
    `<!doctype html><html data-theme="${theme}" data-mode="live"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    FONTS +
    `<style>${styleCss}\n${OVERRIDES}</style></head><body>${bodyHtml}<script>${scriptJs}</script></body></html>`
  );
}

function currentTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function DashboardPage() {
  const [theme, setTheme] = React.useState<"light" | "dark">(currentTheme);

  // Keep the iframe's theme in sync when the app's light/dark toggle flips the
  // `dark` class on <html> (the mock reads data-theme, so we rebuild on change).
  React.useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const doc = React.useMemo(() => buildDoc(theme), [theme]);

  return (
    <div className="-m-6 h-[calc(100vh-66px)]">
      <iframe title="Control Tower" srcDoc={doc} className="h-full w-full border-0" />
    </div>
  );
}
