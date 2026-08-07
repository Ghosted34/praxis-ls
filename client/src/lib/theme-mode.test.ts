/**
 * `color-scheme` has to move with the theme, not just be set once at boot.
 *
 * It is the declaration the BROWSER paints its own surfaces from — scrollbars,
 * the default form controls, and in an installed PWA window the caption-button
 * glyphs beside the app's title bar. The pre-paint script in index.html writes
 * it before first paint (which is why a cold start looks right), but nothing
 * wrote it again: after a toggle the page said "dark" while rendering light,
 * and a user on "system" whose OS flipped mid-session never moved at all.
 *
 * The class and the declaration are two halves of one appearance, so these pin
 * that they are always written together.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setMode, initThemeMode, getMode, resolved } from "./theme-mode";

/** The OS preference, controllable per test. `initThemeMode` also subscribes to
 *  it, so the stub has to carry real listeners rather than no-op stubs. */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? dark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    dispatchEvent: () => false,
  }));
  return { fire: () => listeners.forEach((fn) => fn()) };
}

const root = () => document.documentElement;
const scheme = () => root().style.colorScheme;
const isDark = () => root().classList.contains("dark");

describe("theme-mode — the class and color-scheme are one appearance", () => {
  beforeEach(() => {
    localStorage.clear();
    root().className = "";
    root().removeAttribute("style");
    vi.unstubAllGlobals();
  });

  it("writes color-scheme alongside .dark on an explicit choice", () => {
    stubMatchMedia(false);

    setMode("dark");
    expect(isDark()).toBe(true);
    expect(scheme()).toBe("dark");

    setMode("light");
    expect(isDark()).toBe(false);
    expect(scheme()).toBe("light");
  });

  /**
   * The reported sequence: refresh in dark (correct), toggle to light, toggle
   * back. Before the fix the declaration stuck at whatever boot wrote and the
   * browser kept drawing its own chrome for the wrong theme in between.
   */
  it("does not go stale across a light → dark round trip", () => {
    stubMatchMedia(false);
    initThemeMode();

    setMode("light");
    expect(scheme()).toBe("light");
    setMode("dark");
    expect(scheme()).toBe("dark");
  });

  it("follows the OS while the mode is 'system', including a mid-session flip", () => {
    const os = stubMatchMedia(true);
    setMode("system");
    expect(isDark()).toBe(true);
    expect(scheme()).toBe("dark");

    initThemeMode();
    // The OS goes light under a user who never touched the toggle.
    vi.unstubAllGlobals();
    stubMatchMedia(false);
    os.fire();
    expect(isDark()).toBe(false);
    expect(scheme()).toBe("light");
  });

  it("keeps an explicit choice when the OS disagrees", () => {
    stubMatchMedia(true);
    setMode("light");
    expect(getMode()).toBe("light");
    expect(resolved()).toBe("light");
    expect(scheme()).toBe("light");
  });
});
