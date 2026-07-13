import { tenant } from "./api-client";

/** A partner/brand chip shown on the landing hero (e.g. sub-brands the tenant runs). */
export type BrandPill = {
  /** Short label, rendered small-caps (e.g. "Faitlyn Hair"). */
  label: string;
  /** Optional icon/avatar URL shown inside the pill. */
  iconUrl?: string | null;
};

/** A colour-token bag (key → CSS colour string). Edited in the Appearance token editor. */
export type ThemeTokens = Record<string, string>;

/** Font role selections for the platform. */
export type Typography = {
  display?: string | null;
  body?: string | null;
  mono?: string | null;
  customFontUrl?: string | null;
};

/** Per-business brand (Layer B) — gradient + accent + logo, used on chips/documents. */
export type BusinessBrand = {
  id: string;
  name: string;
  accent?: string | null;
  gradientStart?: string | null;
  gradientEnd?: string | null;
  logoUrl?: string | null;
  website?: string | null;
};

/** Login-screen content (the DB-driven signed-out door). */
export type HouseQuote = { text: string; attribution?: string | null };
export type Pillar = { icon?: string | null; title: string; body?: string | null };
export type RegionalWelcome = { region: string; title?: string | null; body?: string | null };

export type LoginContent = {
  splashSubline?: string | null;
  /** Call-to-action button label on the hero. */
  buttonLabel?: string | null;
  /** Backdrop mode: brand mesh vs a full-bleed image. */
  background?: "mesh" | "image" | null;
  showSplash?: boolean | null;
  showWebsiteLinks?: boolean | null;
  showQuickPin?: boolean | null;
  quotes?: HouseQuote[] | null;
  pillars?: Pillar[] | null;
  regionals?: RegionalWelcome[] | null;
};

export type Branding = {
  // --- Persisted by the backend today (branding.service.js) ---
  name: string | null;
  primary: string | null;
  primaryForeground: string | null;
  logoUrl: string | null;

  // --- Extended white-label fields (pixie spec). Sent on save; the backend
  //     stores the four above now and will persist the rest once the
  //     `appearance` settings schema is extended (see doc/FE_IA_HANDOFF.md). ---
  companyName?: string | null;
  tagline?: string | null;
  logoDarkUrl?: string | null;
  logoLightUrl?: string | null;
  faviconUrl?: string | null;
  themePreset?: string | null;
  tokensDark?: ThemeTokens | null;
  tokensLight?: ThemeTokens | null;
  panelAlpha?: number | null;
  borderAlpha?: number | null;
  meshOpacity?: number | null;
  typography?: Typography | null;
  businesses?: BusinessBrand[] | null;
  login?: LoginContent | null;

  /**
   * Landing/hero content — all optional and white-label. Absent fields fall back
   * to generic copy derived from `name` (see landing-page.tsx).
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

/** Public — resolved by Host, no auth. Used to brand the login pre-auth. */
export const fetchBranding = () => tenant<Branding>("/branding", { auth: false });

/** Gated (MOD-70 edit). Upserts only the provided fields; returns the merged result. */
export const saveBranding = (patch: Partial<Branding>) =>
  tenant<Branding>("/branding", { method: "PUT", body: patch });

/** Gated (MOD-70 edit). Uploads a base64 image data URL to file storage; returns
 *  its public /media URL. Persist it with saveBranding() (logo or hero image). */
export const uploadImage = (dataUrl: string) =>
  tenant<{ logoUrl: string }>("/branding/logo", { method: "POST", body: { dataUrl } });

/** @deprecated alias kept for existing callers — use uploadImage. */
export const uploadLogo = uploadImage;
