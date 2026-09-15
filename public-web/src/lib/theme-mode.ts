/**
 * Light/dark mode for a public surface.
 *
 * ── THE LOCK ───────────────────────────────────────────────────────────────
 *
 * `FORCE_DARK` below pins this app to dark and is the ONLY line to change to
 * hand light mode back. While it is on:
 *
 *   · `getMode()` answers "dark" without reading storage, so a visitor
 *     carrying an older `praxis.public.theme: "light"` gets dark too.
 *   · `setMode()` is a no-op, so nothing can write light back.
 *   · `ThemeToggle` renders nothing, so there is no control to reach it with.
 *   · `syncTenantThemePreference` in `app/branding.tsx` stops applying a
 *     tenant's `theme: "light"` hint.
 *
 * The light token block in `index.css` is deliberately LEFT IN PLACE. Deleting
 * it would be the same change spread over ~60 custom properties and a one-line
 * revert becomes a merge; every one of those values is still contrast-tested by
 * `lib/theme.test.ts`, and the lock already makes them unreachable.
 *
 * Two states when unlocked, not three. The staff app offers light / dark /
 * system because its users live in the app for eight hours a day and have an
 * opinion; a visitor who lands here for ninety seconds does not, and a "system"
 * option on a marketing page is a third thing to understand.
 *
 * Two writes, one read:
 *   · `.dark` on <html> drives this app's own token block (mirroring `client`).
 *   · `data-theme` drives `@praxis/brand/tokens.css`, whose `--brand-*` values
 *     otherwise follow the OS. Without the attribute, a visitor on a dark OS
 *     would get brand-layer dark tokens under light-layer app tokens — orange
 *     stepped for carbon, sitting on white.
 */

export type ThemeMode = "light" | "dark";

/**
 * Dark only, everywhere, for everyone.
 *
 * Flip to `false` to restore the toggle. The inline pre-paint script in
 * `index.html` CANNOT import this — it runs before any module — so it carries
 * the same decision in about six lines. `theme-mode.test.ts` pins the two
 * together by reading the HTML, which is what stops them drifting.
 */
// Annotated `boolean` rather than left to infer `true`. Without the annotation
// TypeScript narrows it to the literal, every line after each `if (FORCE_DARK)`
// becomes statically dead, and flipping the switch to `false` is what surfaces
// the resulting errors — in the one edit that is supposed to be safe.
export const FORCE_DARK: boolean = true;

export const THEME_KEY = "praxis.public.theme";

const root = () => document.documentElement;

export function getMode(): ThemeMode {
  if (FORCE_DARK) return "dark";
  try {
    // Dark is the default even unlocked: only an explicit "light" — which only
    // the toggle writes — opts out of it.
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    /* storage unavailable (private mode, embedded webview) — dark stands */
    return "dark";
  }
}

/** Paint the current mode. Called once from main.tsx so React and the DOM agree
 *  even when the inline script has already done it (it is idempotent). */
export function applyMode(mode: ThemeMode): void {
  const el = root();
  el.classList.toggle("dark", mode === "dark");
  el.dataset.theme = mode;
  // THREE signals now. `color-scheme` is what native UI reads — scrollbars,
  // `<select>` popups, the canvas the browser paints before the stylesheet
  // lands — and none of it follows a class or a data attribute. The pre-paint
  // script in `index.html` writes it as an INLINE style, which outranks every
  // stylesheet, so it has to be rewritten here rather than declared in
  // `index.css`: declaring it there and setting it there would leave the
  // stylesheet permanently losing to the first-paint value.
  el.style.colorScheme = mode;
}

export function setMode(mode: ThemeMode): void {
  // Under the lock this is a no-op rather than a throw: the callers are UI
  // handlers, and a theme control that explodes is worse than one that is
  // simply not there — which, while `FORCE_DARK` holds, it is not.
  if (FORCE_DARK) return;
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
  if (FORCE_DARK) return "dark";
  const next: ThemeMode = getMode() === "dark" ? "light" : "dark";
  setMode(next);
  return next;
}
