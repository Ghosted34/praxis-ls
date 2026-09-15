import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORCE_DARK,
  THEME_KEY,
  applyMode,
  getMode,
  initThemeMode,
  setMode,
  toggleMode,
} from "./theme-mode";

const html = () =>
  readFileSync(join(process.cwd(), "index.html"), "utf8");

/**
 * The lock has TWO implementations — this module and the inline pre-paint script
 * in `index.html`, which cannot import it because it runs before any module
 * does. Two copies of one decision is exactly the shape that drifts, and it
 * drifts in the direction nobody notices: the module is what every test
 * exercises, while the script is what every visitor's first frame actually
 * gets. So the script is asserted here, as text.
 */
describe("forced dark mode", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("is on", () => {
    // The one line to change to hand light mode back. It is asserted so that
    // flipping it fails loudly here rather than quietly in production.
    expect(FORCE_DARK).toBe(true);
  });

  it("answers dark even for a visitor carrying a stored light preference", () => {
    // The case the lock exists for. Anyone who pressed the toggle before this
    // landed still has "light" in their browser; without the storage bypass in
    // `getMode`, they would be the only people still seeing a white site.
    localStorage.setItem(THEME_KEY, "light");
    expect(getMode()).toBe("dark");
    expect(initThemeMode()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("cannot be written out of dark", () => {
    setMode("light");
    expect(getMode()).toBe("dark");
    // Nothing reached storage either: an un-lock must not find a "light" that
    // the visitor never chose waiting for it.
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(toggleMode()).toBe("dark");
    expect(getMode()).toBe("dark");
  });

  it("writes colour-scheme alongside the class and the attribute", () => {
    // Native UI — scrollbars, `<select>` popups — reads this and nothing else,
    // so a page that sets only the class keeps a white scrollbar on carbon.
    applyMode("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("has a pre-paint script in index.html that agrees with this module", () => {
    const source = html();
    // From the <script> tag itself, not from the comment above it: the comment
    // documents how to UNLOCK, so it names `localStorage` in prose, and the
    // assertion below is about what the browser RUNS.
    const open = source.indexOf("<script>", source.indexOf("PRE-PAINT THEME"));
    const script = source.slice(open, source.indexOf("</script>", open));
    expect(script).toContain('var mode = "dark"');
    expect(script).toContain('classList.add("dark")');
    expect(script).toContain('setAttribute("data-theme", mode)');
    expect(script).toContain("colorScheme");
    // The storage read is what the lock removes. If it comes back while
    // FORCE_DARK is on, the first painted frame can be light while every module
    // that runs afterwards says dark — the flash the pre-paint script exists to
    // prevent, pointing the other way.
    //
    // Comments are stripped before the check: the script deliberately CARRIES
    // the read in a `//` line as the unlock instruction, and matching that
    // would fail the test for documenting itself.
    const live = script.replace(/^\s*\/\/.*$/gm, "");
    expect(live).not.toContain("localStorage");
  });

  it("pins theme-color to the dark background, with no light alternative", () => {
    // A `media="(prefers-color-scheme: light)"` variant here would tint a
    // phone's browser chrome white above a carbon page — the one piece of
    // light-mode surface a locked app could still ship.
    const source = html();
    const tags = source.match(/<meta name="theme-color"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain("#0b0d11");
    expect(tags[0]).not.toContain("prefers-color-scheme");
  });
});
