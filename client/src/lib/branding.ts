import { tenant } from "./api-client";

/** A partner/brand chip shown on the legacy landing hero. */
export type BrandPill = {
  label: string;
  iconUrl?: string | null;
};

/**
 * Tenant appearance — matches the backend `GET/PUT /branding` contract
 * (branding.service.js). The four core fields are always present (branding
 * context paints a default before the fetch); the rest of the token set is
 * optional so the default literal and pre-fetch state stay valid.
 */
export type Branding = {
  name: string | null;
  primary: string | null;
  primaryForeground: string | null;
  logoUrl: string | null;

  // Extended appearance token set (all persisted by PUT /branding).
  secondary?: string | null;
  accent?: string | null;
  accentDeep?: string | null;
  accentGlow?: string | null;
  info?: string | null;
  success?: string | null;
  warn?: string | null;
  danger?: string | null;
  logoAltUrl?: string | null;
  faviconUrl?: string | null;
  fontDisplay?: string | null;
  fontBody?: string | null;
  fontMono?: string | null;
  radius?: string | null;
  theme?: "dark" | "light" | null;

  /**
   * Legacy landing hero — still read by landing-page.tsx as a fallback. Not
   * persisted by the current backend; live login content is in LoginConfig
   * (GET/PUT /branding/login). Kept optional for backward compatibility.
   */
  hero?: {
    eyebrow?: string | null;
    headline?: string | null;
    subheadline?: string | null;
    body?: string | null;
    imageUrl?: string | null;
    pills?: BrandPill[] | null;
  } | null;
};

/** Login-screen config — backend `GET/PUT /branding/login` (branding.service.js). */
export type LoginConfig = {
  backgroundUrl: string | null;
  headline: string | null;
  subtext: string | null;
  layout: "centered" | "split" | null;
  showLogo: boolean | null;
  accentOverride: string | null;
};

// ── Appearance ──
/** Public — resolved by Host, no auth. Brands the login pre-auth. */
export const fetchBranding = () => tenant<Branding>("/branding", { auth: false });

/** Gated (MOD-70 edit). Upserts only the provided fields; returns the merged result. */
export const saveBranding = (patch: Partial<Branding>) =>
  tenant<Branding>("/branding", { method: "PUT", body: patch });

/** Gated (MOD-70 edit). Uploads a base64 image data URL; returns its /media URL. */
export const uploadImage = (dataUrl: string) =>
  tenant<{ logoUrl: string }>("/branding/logo", { method: "POST", body: { dataUrl } });

/** @deprecated alias kept for existing callers — use uploadImage. */
export const uploadLogo = uploadImage;

// ── Login screen ──
/** Public — the login page reads this pre-auth. */
export const fetchLogin = () => tenant<LoginConfig>("/branding/login", { auth: false });

/** Gated (MOD-70 edit). */
export const saveLogin = (patch: Partial<LoginConfig>) =>
  tenant<LoginConfig>("/branding/login", { method: "PUT", body: patch });

/** Gated (MOD-70 edit). Uploads a base64 login background; returns its /media URL. */
export const uploadLoginBackground = (dataUrl: string) =>
  tenant<{ backgroundUrl: string }>("/branding/login/background", { method: "POST", body: { dataUrl } });
