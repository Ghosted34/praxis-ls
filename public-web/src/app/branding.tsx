/**
 * The branding provider — how a tenant's identity gets onto a stranger's screen.
 *
 * One fetch (`GET /branding`, public, Host-resolved), one paint
 * (`lib/theme.ts` → the CSS custom properties every component in this app reads),
 * one cache (so the next visit is branded before it is online). That is the
 * whole job; the staff app's provider does the same thing plus PWA chrome and a
 * per-user appearance override, neither of which exists for an anonymous visitor.
 *
 * ── WHY THE SITE IS NOT HARD-BRANDED ──────────────────────────────────────
 *
 * This is a white-label product: the `/public` pages belong to the logistics
 * operator, not to Praxis. Painting Praxis's logo on a tenant's front door would
 * be the one bug that makes the whole surface wrong for every tenant at once,
 * which is also why the fallback is Praxis-neutral copy rather than a sample
 * company (see `DEFAULT_BRANDING`).
 *
 * A failure to fetch is NOT an error state here. A marketing page that shows a
 * red banner because the branding call timed out is worse than the same page in
 * default dress, so the catch is silent on purpose and the cache/default stands.
 */
import * as React from "react";
import {
  DEFAULT_BRANDING,
  fetchBranding,
  fetchLoginConfig,
  readCachedBranding,
  writeCachedBranding,
  type Branding,
  type LoginConfig,
} from "@/lib/branding";
import { applyBrand } from "@/lib/theme";
import {
  applySiteTheme,
  getSiteTheme,
  readCachedSiteTheme,
  writeCachedSiteTheme,
} from "@/lib/site-theme";
import { FORCE_DARK, getMode } from "@/lib/theme-mode";

type Ctx = {
  branding: Branding;
  /** null until `GET /branding/login` resolves (or fails — it is optional). */
  login: LoginConfig | null;
  /** The tenant has configured nothing yet: render generic copy, not blanks. */
  isDefault: boolean;
};

const BrandingContext = React.createContext<Ctx>({
  branding: DEFAULT_BRANDING,
  login: null,
  isDefault: true,
});

export const DEFAULT_PRIMARY = "#ff5a00";

/** The `theme` a tenant picked in Appearance is a hint, not an order: a public
 *  visitor's own persisted choice wins, because they are the one reading it.
 *
 *  While `FORCE_DARK` holds, the hint is not applied at all. This was the last
 *  path to a light page and the worst-looking one: `GET /branding` resolves
 *  AFTER first paint, so a tenant with `theme: "light"` did not merely start
 *  light — the site painted dark and then flipped to white under the reader a
 *  beat later, on every load, for every visitor who had never touched the
 *  toggle. Locking the mode without this line would have left that flip in
 *  place and made it look like a bug in the lock. */
function syncTenantThemePreference(b: Branding): void {
  if (FORCE_DARK) return;
  if (!b.theme) return;
  const stored = (() => {
    try {
      return localStorage.getItem("praxis.public.theme");
    } catch {
      return null;
    }
  })();
  if (stored === "light" || stored === "dark") return;
  if (getMode() !== b.theme) {
    // Only ever before the visitor has chosen, so this cannot flip a page under
    // somebody mid-read.
    document.documentElement.classList.toggle("dark", b.theme === "dark");
    document.documentElement.dataset.theme = b.theme;
  }
}

function paintDocumentIdentity(b: Branding): void {
  applyBrand({ ...b, primary: b.primary || DEFAULT_PRIMARY });
  syncTenantThemePreference(b);

  if (b.name) {
    document.title = b.name;
    const og = document.querySelector<HTMLMetaElement>(
      'meta[property="og:site_name"]',
    );
    if (og) og.content = b.name;
  }

  if (b.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    // No fixed `type`: a tenant's favicon is as often a PNG as an .ico, and a
    // mismatched type is how a configured icon silently never shows.
    link.removeAttribute("type");
    link.href = b.faviconUrl;
  }
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setState] = React.useState<Branding>(
    () => readCachedBranding() ?? DEFAULT_BRANDING,
  );
  const [login, setLogin] = React.useState<LoginConfig | null>(null);

  React.useEffect(() => {
    // Paint the cached identity synchronously on this effect (before the first
    // fetch can land) so a repeat visit never shows the default dress.
    paintDocumentIdentity(branding);

    // The WEBSITE's own palette, from the cache, painted after the branding
    // above so it wins on colour for the surface it owns. `GET /branding` is the
    // ERP's appearance row — the logo, the name, and the colours the tenant's
    // staff see all day; this is the row for the site strangers judge them by,
    // and the two are deliberately separate records.
    const cachedTheme = readCachedSiteTheme();
    if (cachedTheme) applySiteTheme(cachedTheme);

    let alive = true;
    // allSettled, not all: a tenant with no login config (the common case) must
    // not stop their colours from being applied, and a website theme that 404s
    // (the `website` package off) must not stop their branding.
    void Promise.allSettled([
      fetchBranding(),
      fetchLoginConfig(),
      getSiteTheme(),
    ]).then(([b, l, t]) => {
      if (!alive) return;
      if (b.status === "fulfilled" && b.value) {
        setState(b.value);
        paintDocumentIdentity(b.value);
        writeCachedBranding(b.value);
      }
      if (l.status === "fulfilled" && l.value) setLogin(l.value);
      if (t.status === "fulfilled" && t.value) {
        // Applied LAST, for the reason above: on this surface the website's
        // theme is the answer and the ERP's appearance is the floor beneath it.
        applySiteTheme(t.value);
        writeCachedSiteTheme(t.value);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDefault = !branding.name;

  return (
    <BrandingContext.Provider value={{ branding, login, isDefault }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): Ctx {
  return React.useContext(BrandingContext);
}
