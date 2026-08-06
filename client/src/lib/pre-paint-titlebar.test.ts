/**
 * The inline "pre-paint" script in index.html is the fix for the WCO
 * light-flash bug: on refresh, the app's title-bar strip (and Chrome's own
 * chrome via <meta name="theme-color">) briefly rendered LIGHT on a dark
 * workspace because main.tsx is a `type="module"` script and modules are
 * deferred, so nothing had set `.dark` or restored `--titlebar-bg` yet when
 * the body first painted.
 *
 * The script must run synchronously in <head> before the body paints, which
 * makes it awkward to import — so it lives inline. This test reads that
 * script out of the actual index.html, runs it against a mocked
 * localStorage + document, and pins the four behaviours the fix depends on:
 *
 *   1. dark class on <html> when the stored theme resolves to dark
 *   2. --titlebar-bg set from the cached value (a returning user's session)
 *   3. --titlebar-bg set to the theme-matched default when no cache exists
 *      (first ever launch — must not fall through to raw white)
 *   4. <meta name="theme-color"> updated in step, so Chrome's own chrome
 *      doesn't flash the light static value
 *
 * If the inline script is removed or rewritten in a way that drops any of
 * these, this test fails and points at the exact line.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";

// Extract the inline pre-paint IIFE from index.html once at load time. Doing
// this against the real file (not a fixture) is the whole point — a rewrite
// of the file changes what this test evaluates, so a regression cannot slip
// past by mutating the copy the test used.
function loadPrePaintScript(): string {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../../index.html"),
    "utf8",
  );
  // Grab the first <script>…</script> that references our cache key — that
  // is the pre-paint IIFE. Any other script tag (module tag for main.tsx,
  // future analytics, etc.) is skipped.
  const match = html.match(/<script>([\s\S]*?praxis\.titlebar[\s\S]*?)<\/script>/);
  if (!match) throw new Error("pre-paint script not found in index.html");
  return match[1];
}

const script = loadPrePaintScript();

function runPrePaint(env: {
  theme?: string | null;
  titlebarDark?: string | null;
  titlebarLight?: string | null;
  osIsDark?: boolean;
}) {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.head.innerHTML = '<meta name="theme-color" content="#f4f7fb">';

  const store: Record<string, string> = {};
  if (env.theme != null) store["praxis.theme"] = env.theme;
  if (env.titlebarDark != null) store["praxis.titlebar.dark"] = env.titlebarDark;
  if (env.titlebarLight != null) store["praxis.titlebar.light"] = env.titlebarLight;

  const fakeLocalStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  };
  const fakeMatchMedia = (q: string) => ({
    matches: q.includes("dark") ? !!env.osIsDark : false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });

  // The script reads `localStorage` and `window.matchMedia` as free
  // references, so eval them in a scope that provides both.
  const runner = new Function(
    "localStorage",
    "window",
    "document",
    `(function(){${script}})();`,
  );
  runner(fakeLocalStorage, { matchMedia: fakeMatchMedia }, document);
}

const themeColor = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content;
const cssVar = (n: string) => document.documentElement.style.getPropertyValue(n);

describe("pre-paint titlebar script (index.html <head>)", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  it("adds `.dark` to <html> before first paint when the stored theme is dark", () => {
    runPrePaint({ theme: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps <html> in light mode when the stored theme is light, regardless of OS", () => {
    runPrePaint({ theme: "light", osIsDark: true });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the OS preference when the stored theme is 'system' or absent", () => {
    runPrePaint({ theme: "system", osIsDark: true });
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    runPrePaint({ theme: null, osIsDark: false });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("restores the cached --titlebar-bg for a returning user (dark)", () => {
    runPrePaint({ theme: "dark", titlebarDark: "#1a2233" });
    expect(cssVar("--titlebar-bg")).toBe("#1a2233");
    // And the browser-chrome meta follows in step.
    expect(themeColor()).toBe("#1a2233");
  });

  it("uses the theme-matched DEFAULT when no cached colour exists — no white flash on a dark workspace", () => {
    // The scenario the bug report described: first ever refresh in dark mode
    // (or after clearing storage). Before the fix, --titlebar-bg was left
    // unset and the pre-boot bar painted its raw #ffffff fallback.
    runPrePaint({ theme: "dark" });
    expect(cssVar("--titlebar-bg")).toBe("#12161e"); // SURFACE_DARK
    expect(themeColor()).toBe("#12161e");
  });

  it("uses the light default when the theme resolves to light and no cache exists", () => {
    runPrePaint({ theme: "light" });
    expect(cssVar("--titlebar-bg")).toBe("#ffffff"); // SURFACE_LIGHT
    expect(themeColor()).toBe("#ffffff");
  });

  it("sets color-scheme on <html> so browser controls follow the theme", () => {
    runPrePaint({ theme: "dark" });
    expect(document.documentElement.style.colorScheme).toBe("dark");

    runPrePaint({ theme: "light" });
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
