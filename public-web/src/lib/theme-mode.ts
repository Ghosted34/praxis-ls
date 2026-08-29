/**
 * Light/dark mode for a public surface.
 *
 * Two states, not three. The staff app offers light / dark / system because its
 * users live in the app for eight hours a day and have an opinion; a visitor who
 * lands here for ninety seconds does not, and a "system" option on a marketing
 * page is a third thing to understand. The choice is persisted and never
 * overridden afterwards — see the note in `index.html` on the inline pre-paint
 * script, which is the other half of this file.
 *
 * Two writes, one read:
 *   · `.dark` on <html> drives this app's own token block (mirroring `client`).
 *   · `data-theme` drives `@praxis/brand/tokens.css`, whose `--brand-*` values
 *     otherwise follow the OS. Without the attribute, a visitor on a dark OS
 *     would get brand-layer dark tokens under light-layer app tokens — orange
 *     stepped for carbon, sitting on white.
 */

export type ThemeMode = "light" | "dark";

export const THEME_KEY = "praxis.public.theme";

const root = () => document.documentElement;

export function getMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    /* storage unavailable (private mode, embedded webview) — light stands */
    return "light";
  }
}

/** Paint the current mode. Called once from main.tsx so React and the DOM agree
 *  even when the inline script has already done it (it is idempotent). */
export function applyMode(mode: ThemeMode): void {
  const el = root();
  el.classList.toggle("dark", mode === "dark");
  el.dataset.theme = mode;
}

export function setMode(mode: ThemeMode): void {
  applyMode(mode);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* the choice lives for this page view only */
  }
}

/** Apply the stored mode at boot. Idempotent with the inline script in
 *  `index.html`, and the single place a "system" preference would be wired to a
 *  `matchMedia` listener if this app ever grows one. */
export function initThemeMode(): ThemeMode {
  const mode = getMode();
  applyMode(mode);
  return mode;
}

export function toggleMode(): ThemeMode {
  const next: ThemeMode = getMode() === "dark" ? "light" : "dark";
  setMode(next);
  return next;
}
