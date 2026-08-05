/**
 * Branding context — fetches the tenant's white-label appearance (public
 * endpoint, resolved by Host) on mount, applies it to CSS variables, and exposes
 * {name, logoUrl} to the login + shell. A build-time default colour paints
 * instantly so there's never a monochrome flash before the fetch resolves;
 * setBranding() lets the Appearance screen update it live after a save.
 */
import * as React from "react";
import { applyBrand } from "@/lib/theme";
import { fetchBranding, type Branding } from "@/lib/branding";
import { loadFonts, DEFAULT_STACK, DEFAULT_MONO_STACK } from "@/lib/fonts";
import { EMPTY_USER_APPEARANCE, type UserAppearance } from "@/lib/preferences";

const DEFAULT_PRIMARY = import.meta.env.VITE_BRAND_PRIMARY || "#0f766e";

type Ctx = {
  branding: Branding;
  setBranding: (b: Branding) => void;
  /** The signed-in user's personal typography overrides (see lib/preferences). */
  userAppearance: UserAppearance;
  /** Applied on top of the tenant's fonts and repainted immediately. */
  setUserAppearance: (a: UserAppearance) => void;
  ready: boolean; // true once the public /branding fetch has resolved (or failed)
};

const BrandingCtx = React.createContext<Ctx | null>(null);

/**
 * TWO LAYERS, ONE PAINT. The tenant's branding is the base; the user's
 * typography sits on top. Merging here rather than at either call site means
 * there is exactly one place that decides precedence, and both the boot fetch
 * and a live save from either editor go through it.
 *
 * Only the three type tokens are user-overridable — a user cannot restyle the
 * company's colours or logo, which is enforced on the server too
 * (preference.service.js). An empty-string override is treated as absent so a
 * cleared field falls back to the tenant value rather than to no font at all.
 */
function resolveFonts(b: Branding, u: UserAppearance) {
  return {
    fontDisplay: u.fontDisplay || b.fontDisplay,
    fontBody: u.fontBody || b.fontBody,
    fontMono: u.fontMono || b.fontMono,
  };
}

function paint(b: Branding, u: UserAppearance = EMPTY_USER_APPEARANCE) {
  const fonts = resolveFonts(b, u);
  // Fetch the woff2 for whatever is actually in force — at most three families
  // out of the fifteen in the library. Fire-and-forget: @fontsource ships
  // `font-display: swap`, so text paints in the fallback now and reflows into
  // the real face when the chunk lands. Awaiting it would block the paint below
  // on the network for no gain.
  //
  // An UNSET slot loads the library default rather than nothing. index.css
  // declares Inter and JetBrains Mono for the unset case, and a declared family
  // whose @font-face was never imported renders the generic fallback instead —
  // which is exactly how `--font-mono` was resolving to the browser's monospace
  // on every screen that shows a document reference.
  void loadFonts([
    fonts.fontDisplay || DEFAULT_STACK,
    fonts.fontBody || DEFAULT_STACK,
    fonts.fontMono || DEFAULT_MONO_STACK,
  ]);
  applyBrand({
    primary: b.primary || DEFAULT_PRIMARY,
    primaryForeground: b.primaryForeground || "#ffffff",
    secondary: b.secondary,
    accent: b.accent,
    accentDeep: b.accentDeep,
    info: b.info,
    success: b.success,
    warn: b.warn,
    danger: b.danger,
    ...fonts,
    radius: b.radius,
  });
  // Reflect the tenant's brand name in the browser tab (falls back to the app
  // name before/without tenant branding).
  document.title = b.name || "Praxis LS";
  // Swap the tab favicon to the tenant's uploaded one. The static index.html
  // link is only the default; nothing applied the branding favicon before, so a
  // configured favicon never showed.
  if (b.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    // Drop the fixed type so PNG/WEBP favicons aren't mislabelled as x-icon.
    link.removeAttribute("type");
    link.href = b.faviconUrl;
  }
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setState] = React.useState<Branding>({
    name: null,
    primary: DEFAULT_PRIMARY,
    primaryForeground: "#ffffff",
    logoUrl: null,
  });
  const [userAppearance, setUserState] = React.useState<UserAppearance>(EMPTY_USER_APPEARANCE);
  const [ready, setReady] = React.useState(false);

  // Each setter repaints BOTH layers, so each needs the other's current value.
  // Refs rather than effect dependencies: a repaint must happen at the moment
  // the save resolves, and reading the live ref keeps the two setters
  // independent of render timing — without them, saving branding would repaint
  // using whatever overrides were captured when the callback was created and
  // silently drop the user's fonts until the next reload.
  const brandingRef = React.useRef(branding);
  const userRef = React.useRef(userAppearance);

  // Paint the default immediately, then fetch and re-paint with the tenant's own.
  React.useEffect(() => {
    paint(branding, userAppearance);
    fetchBranding()
      .then((b) => {
        brandingRef.current = b;
        setState(b);
        paint(b, userRef.current);
      })
      .catch(() => {
        /* no branding configured / offline — keep the default */
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBranding = React.useCallback((b: Branding) => {
    brandingRef.current = b;
    setState(b);
    paint(b, userRef.current);
  }, []);

  const setUserAppearance = React.useCallback((a: UserAppearance) => {
    userRef.current = a;
    setUserState(a);
    paint(brandingRef.current, a);
  }, []);

  return (
    <BrandingCtx.Provider value={{ branding, setBranding, userAppearance, setUserAppearance, ready }}>
      {children}
    </BrandingCtx.Provider>
  );
}

export function useBranding() {
  const ctx = React.useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
