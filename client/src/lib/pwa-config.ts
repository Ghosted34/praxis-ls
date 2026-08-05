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
export const { effectivePwa, iconLayout, PWA_DEFAULTS, PWA_RANGES, SPLASH_FALLBACK_BG } = pwaDesign;

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
};

/** Narrow the full Branding shape to the fields the PWA resolution inherits. */
export function brandSource(b: Branding): PwaBrandSource {
  return { name: b.name, primary: b.primary, logoUrl: b.logoUrl, theme: b.theme };
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

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = cfg.themeColor;

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
