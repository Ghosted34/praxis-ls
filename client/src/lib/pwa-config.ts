/**
 * Installed-app (PWA) design — the client half of `GET/PUT /branding/pwa`.
 *
 * The TYPES and the fallback resolution both come from `@shared`
 * (packages/shared/pwa-design.js), which the Express API uses to render the
 * actual home-screen PNG. That is deliberate: this module feeds the editor's
 * previews, and a preview computed from a second copy of the rules would be a
 * preview of something else.
 */
import { pwaDesign, type PwaConfig, type EffectivePwa, type PwaBrandSource } from "@shared";
import { tenant } from "./api-client";
import type { Branding } from "./branding";

export type { PwaConfig, EffectivePwa };
export const { effectivePwa, iconLayout, resolveTitlebar, PWA_DEFAULTS, PWA_RANGES, SPLASH_FALLBACK_BG } =
  pwaDesign;

/** Everything unset — what a tenant that has never opened the editor has. */
export const EMPTY_PWA_CONFIG: PwaConfig = {
  appName: null,
  shortName: null,
  description: null,
  display: null,
  orientation: null,
  themeColor: null,
  backgroundColor: null,
  iconUrl: null,
  iconBackground: null,
  iconPadding: null,
  iconZoom: null,
  iconOffsetX: null,
  iconOffsetY: null,
  iconRadius: null,
  maskableBackground: null,
  maskablePadding: null,
  splashEnabled: null,
  splashPreset: null,
  splashDuration: null,
  splashBackground: null,
  splashTagline: null,
  splashShowProgress: null,
  installEnabled: null,
  installTitle: null,
  installBody: null,
  installIosBody: null,
  installButton: null,
  offlineText: null,
  offlineReadyText: null,
  updateTitle: null,
  updateBody: null,
  updateButton: null,
  titlebarMode: null,
  titlebarLight: null,
  titlebarDark: null,
  titlebarImageUrl: null,
  titlebarImageOpacity: null,
  titlebarBlur: null,
};

/** Narrow the full Branding shape to the fields the PWA resolution inherits. */
export function brandSource(b: Branding): PwaBrandSource {
  return { name: b.name, primary: b.primary, logoUrl: b.logoUrl, theme: b.theme };
}

/**
 * Escape a URL for safe use inside a CSS `url("…")`. The value is a /media path
 * this app minted, but it reaches here through a text input that also accepts a
 * pasted URL — and a `")` in a custom property would break out of the
 * declaration and let the rest of the string be read as CSS.
 */
function cssUrl(url: string): string {
  return url.replace(/["\\]/g, "\\$&").replace(/\n/g, "");
}

/**
 * Apply the document-level parts of the installed-app identity.
 *
 * THE TITLE BAR IS A META TAG, NOT THE MANIFEST. An installed PWA paints its
 * window title bar (the Window Controls Overlay on desktop, the status bar on
 * Android) from the PAGE's `<meta name="theme-color">`, and that overrides the
 * manifest's `theme_color` the moment the page loads. index.html ships a static
 * placeholder for the pre-boot frame; leaving it there meant every tenant got
 * that same off-white bar around their own app, no matter what the manifest
 * said. Nothing in the app updated it — this does.
 *
 * Called on every branding change, so the editor's colour picker moves the real
 * title bar while you drag it, not after a reinstall.
 */
export function applyPwaDocument(cfg: EffectivePwa) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // The LIVE theme, not the tenant's default: the manifest had to guess before
  // our code ran, and this is where the guess gets corrected. `.dark` is what
  // lib/theme-mode.ts writes, including for "system".
  const bar = resolveTitlebar(cfg, root.classList.contains("dark") ? "dark" : "light");

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  // The strip behind the caption buttons. Must equal `--titlebar-bg` below or
  // the window shows a seam where the OS's paint meets the page's.
  meta.content = bar.base;

  root.style.setProperty("--titlebar-bg", bar.base);
  root.style.setProperty("--titlebar-image", bar.imageUrl ? `url("${cssUrl(bar.imageUrl)}")` : "none");
  root.style.setProperty("--titlebar-image-opacity", bar.imageUrl ? String(bar.opacity) : "0");
  root.style.setProperty("--titlebar-image-blur", `${bar.blur}px`);

  // iOS home-screen label. Static "Praxis LS" in index.html, so every tenant's
  // icon was captioned with the vendor's name until now.
  const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (title) title.content = cfg.shortName;
}

/** Public — resolved by Host, no auth. The boot splash reads this pre-login. */
export const fetchPwaConfig = () => tenant<PwaConfig>("/branding/pwa", { auth: false });

/** Gated(edit). Upserts only the provided fields; returns the merged result. */
export const savePwaConfig = (patch: Partial<PwaConfig>) =>
  tenant<PwaConfig>("/branding/pwa", { method: "PUT", body: patch });

/** Gated(edit). Uploads a base64 app-icon data URL; returns its /media URL.
 *  Separate from the logo upload because the size cap is different (2 MB — an
 *  app icon wants to be at least 512px square). */
export const uploadAppIcon = (dataUrl: string) =>
  tenant<{ iconUrl: string }>("/branding/pwa/icon", { method: "POST", body: { dataUrl } });

/** Gated(edit). Title-bar artwork. Reuses the app-icon endpoint — same tenant
 *  namespace, same public /media segment, same 2 MB cap — and only the field it
 *  is assigned to differs. */
export const uploadTitlebarImage = async (dataUrl: string) => (await uploadAppIcon(dataUrl)).iconUrl;
