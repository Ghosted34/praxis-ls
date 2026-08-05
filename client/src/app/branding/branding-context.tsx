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

const DEFAULT_PRIMARY = import.meta.env.VITE_BRAND_PRIMARY || "#0f766e";

type Ctx = {
  branding: Branding;
  setBranding: (b: Branding) => void;
  ready: boolean; // true once the public /branding fetch has resolved (or failed)
};

const BrandingCtx = React.createContext<Ctx | null>(null);

function paint(b: Branding) {
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
    fontDisplay: b.fontDisplay,
    fontBody: b.fontBody,
    fontMono: b.fontMono,
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
  const [ready, setReady] = React.useState(false);

  // Paint the default immediately, then fetch and re-paint with the tenant's own.
  React.useEffect(() => {
    paint(branding);
    fetchBranding()
      .then((b) => {
        setState(b);
        paint(b);
      })
      .catch(() => {
        /* no branding configured / offline — keep the default */
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBranding = React.useCallback((b: Branding) => {
    setState(b);
    paint(b);
  }, []);

  // PERF S14: an inline object literal is a NEW context value on every render,
  // which re-renders every consumer in the tree whether or not anything
  // changed. `setBranding` is already stable via useCallback, so memoising the
  // wrapper makes the identity change only when the branding or ready flag
  // actually does.
  const value = React.useMemo(
    () => ({ branding, setBranding, ready }),
    [branding, setBranding, ready],
  );

  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export function useBranding() {
  const ctx = React.useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
