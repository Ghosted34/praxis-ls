/**
 * Appearance cache — the tenant's white-label identity, kept so it survives
 * OFFLINE.
 *
 * WHY THIS EXISTS. `/branding` and `/branding/pwa` are NETWORK reads made on
 * every boot (branding-context.tsx). Offline — a dropped wifi, a cold reload in
 * a tunnel, a hard refresh with the router down — those reads fail, and the app
 * fell back to the BUILD-TIME default: generic teal "Praxis LS", not the
 * tenant's own colour, name and logo. So the moment a user lost connection and
 * the shell re-rendered, they watched their workspace turn into a stranger's.
 *
 * The fix is to remember the last identity the server gave us and paint from it
 * until the network can confirm a newer one. It is deliberately a localStorage
 * cache and not a per-tenant service worker or a server-rendered shell: the
 * service worker only exists AFTER a first successful online load (that is what
 * installs it and precaches the shell), so by the time an offline reload is
 * served the cached shell, this cache is already warm. It therefore covers the
 * real case for a fraction of the cost.
 *
 * SCOPE IS THE ORIGIN. One tenant per subdomain means one origin per tenant, so
 * localStorage is already tenant-scoped — there is no cross-tenant bleed to
 * guard against, the same reason `praxis.user` and the outbox live here too.
 *
 * NEVER LOAD-BEARING. Every read tolerates absent/corrupt JSON and every write
 * tolerates a private-mode or quota failure by doing nothing. A missing cache
 * just means the pre-network paint uses the default, exactly as before — the
 * cache can only improve the offline paint, never break the online one.
 */
import type { Branding } from "./branding";
import type { PwaConfig } from "./pwa-config";

const BRANDING_KEY = "praxis.branding.cache";
const PWA_KEY = "praxis.pwa.cache";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Absent, unparseable, or storage disabled — all the same to the caller.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota — the cache is a nicety, never load-bearing */
  }
}

/** The last tenant appearance the server returned, or null before the first. */
export const readCachedBranding = (): Branding | null =>
  read<Branding>(BRANDING_KEY);

/** Remember the appearance so the NEXT boot can paint it before the network. */
export const writeCachedBranding = (b: Branding): void =>
  write(BRANDING_KEY, b);

/** The last installed-app config the server returned, or null. */
export const readCachedPwaConfig = (): PwaConfig | null =>
  read<PwaConfig>(PWA_KEY);

/** Remember the PWA config so the splash/offline copy are branded offline too. */
export const writeCachedPwaConfig = (c: PwaConfig): void => write(PWA_KEY, c);
