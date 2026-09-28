/**
 * The portal's own light/dark choice.
 *
 * The public site is locked to dark (`lib/theme-mode.ts`, FORCE_DARK) — a
 * decision about a marketing page read once. The portal is the opposite
 * surface: a signed-in client opens it a few times a week, in daylight, on a
 * phone, to read amounts and dates. The owner chose "soft and friendly, light
 * and airy" for it (portal redesign Q11), so it defaults to LIGHT and offers
 * dark and "match my phone" as a choice the person makes once and keeps.
 *
 * Applied when the portal mounts and handed back to the site's own mode when it
 * unmounts (following a link out to /public must not leave the marketing site
 * light). The pre-paint script in `index.html` makes the same decision for a
 * `/portal` URL before any module runs, so a returning client sees no flash of
 * the site's dark ground first; `theme-mode.test.ts` holds the two together.
 */
import { initThemeMode } from "@/lib/theme-mode";

export type PortalTheme = "light" | "dark" | "system";
export const PORTAL_THEME_KEY = "praxis.portal.theme";

export function getPortalTheme(): PortalTheme {
  try {
    const v = localStorage.getItem(PORTAL_THEME_KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    // @silent:storage — private mode; light, the portal's default, stands.
    return "light";
  }
}

const media = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvePortalTheme(t: PortalTheme = getPortalTheme()): "light" | "dark" {
  if (t === "system") return media()?.matches ? "dark" : "light";
  return t;
}

let siteThemeColor: string | null = null;

function paintThemeColor(mode: "light" | "dark") {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  if (siteThemeColor === null) siteThemeColor = meta.content;
  // The phone's browser chrome takes the page's own ground (`--pt-bg`: the
  // secondary surface in light, the background in dark), read from the tokens
  // rather than typed here so a tenant palette carries into it too.
  const style = getComputedStyle(document.documentElement);
  const ground = style.getPropertyValue(mode === "dark" ? "--background" : "--secondary").trim();
  if (ground) meta.content = ground;
}

export function applyPortalTheme(t: PortalTheme = getPortalTheme()): void {
  const mode = resolvePortalTheme(t);
  const el = document.documentElement;
  el.classList.toggle("dark", mode === "dark");
  el.classList.toggle("light", mode === "light");
  el.dataset.theme = mode;
  el.style.colorScheme = mode;
  paintThemeColor(mode);
}

export function setPortalTheme(t: PortalTheme): void {
  try {
    localStorage.setItem(PORTAL_THEME_KEY, t);
  } catch {
    /* @silent:storage — the choice lives for this visit only */
  }
  applyPortalTheme(t);
}

/** Hand the page back to the public site's own mode. */
export function restoreSiteTheme(): void {
  document.documentElement.classList.remove("light");
  initThemeMode();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && siteThemeColor !== null) meta.content = siteThemeColor;
}

/** Follow the phone while "match my phone" is chosen. Returns the unsubscribe. */
export function watchSystemTheme(): () => void {
  const m = media();
  if (!m) return () => {};
  const on = () => {
    if (getPortalTheme() === "system") applyPortalTheme("system");
  };
  m.addEventListener?.("change", on);
  return () => m.removeEventListener?.("change", on);
}
