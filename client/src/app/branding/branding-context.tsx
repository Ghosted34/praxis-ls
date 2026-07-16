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

  return <BrandingCtx.Provider value={{ branding, setBranding, ready }}>{children}</BrandingCtx.Provider>;
}

export function useBranding() {
  const ctx = React.useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
