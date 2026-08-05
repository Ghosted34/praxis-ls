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
