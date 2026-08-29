import { publicApi } from "./api";

/**
 * Tenant branding — the public reads this app paints itself with.
 *
 * Mirrors the backend contract in `src/modules/branding/branding.service.js`
 * (`KEYS`, camelCase, every field present and possibly null), and drops
 * everything only the staff app needs (logo upload, PWA chrome, the extended
 * glow token). The public `GET /branding` is a SUPERSET of what is read here, so
 * the subset stays valid when the backend adds a field.
 */
export type Branding = {
  name: string | null;
  primary: string | null;
  primaryForeground: string | null;
  logoUrl: string | null;
  logoAltUrl?: string | null;
  faviconUrl?: string | null;
  secondary?: string | null;
  accent?: string | null;
  accentDeep?: string | null;
  info?: string | null;
  success?: string | null;
  warn?: string | null;
  danger?: string | null;
  fontDisplay?: string | null;
  fontBody?: string | null;
  fontMono?: string | null;
  radius?: string | null;
  theme?: "dark" | "light" | null;
};

/** The login-screen config (`GET /branding/login`, authored on /settings/login).
 *  The public app cannot edit it, but it is the one place a tenant stores a
 *  brand image and a headline, so the hero reads the ARTWORK from here. */
export type LoginConfig = {
  backgroundUrl: string | null;
  headline: string | null;
  subtext: string | null;
  layout: "centered" | "split" | null;
  showLogo: boolean | null;
  accentOverride: string | null;
};

/** Painted before the fetch resolves, and left in place if the tenant has never
 *  configured anything. The fallback is deliberately NOT a fake tenant: no
 *  invented company name, no invented address — just the Praxis defaults from
 *  `@praxis/brand`, which is what an un-set-up workspace should look like. */
export const DEFAULT_BRANDING: Branding = {
  name: null,
  primary: null,
  primaryForeground: null,
  logoUrl: null,
};

export const fetchBranding = () =>
  publicApi<Branding>("/branding", { method: "GET" });

export const fetchLoginConfig = () =>
  publicApi<LoginConfig>("/branding/login", { method: "GET" });

/* ── The cache ──────────────────────────────────────────────────────────────
 *
 * The staff app does the same thing (`client/src/lib/appearance-cache.ts`) for a
 * PWA that boots offline. Here the reason is sharper: a stranger's SECOND visit
 * to a marketing site is often the one that converts, and the first paint on
 * that visit must already be the tenant's brand — a white flash that becomes
 * someone else's company for 200ms reads as a broken link, not as a fast site.
 *
 * Written on every successful read; read synchronously at module scope.
 */
const CACHE_KEY = "praxis.public.branding";

export function readCachedBranding(): Branding | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Branding;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedBranding(b: Branding): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(b));
  } catch {
    /* quota or private mode — the fetch still paints */
  }
}
