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
import {
  brandSource,
  effectivePwa,
  fetchPwaConfig,
  EMPTY_PWA_CONFIG,
  type EffectivePwa,
  type PwaConfig,
} from "@/lib/pwa-config";

const DEFAULT_PRIMARY = import.meta.env.VITE_BRAND_PRIMARY || "#0f766e";

type Ctx = {
  branding: Branding;
  setBranding: (b: Branding) => void;
  ready: boolean; // true once the public /branding fetch has resolved (or failed)
  /**
   * The tenant's installed-app design, already resolved against branding — what
   * the boot splash, the install banner and the offline/update prompts render.
   * Fetched HERE, in parallel with branding, rather than by each consumer: the
   * splash is on screen before the first route mounts, so a second waterfall
   * would mean the splash animating with the wrong preset and then correcting
   * itself, which is worse than not animating at all.
   */
  pwa: EffectivePwa;
  /** Raw stored config (nulls = inherit) — what the editor round-trips. */
  pwaConfig: PwaConfig;
  setPwaConfig: (c: PwaConfig) => void;
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
  const [pwaConfig, setPwaState] = React.useState<PwaConfig>(EMPTY_PWA_CONFIG);
  const [ready, setReady] = React.useState(false);

  // Paint the default immediately, then fetch and re-paint with the tenant's own.
  //
  // Both public reads go out together and `ready` waits for BOTH: the splash is
  // already on screen and is driven by the PWA config, so flipping ready on
  // branding alone would reveal the identity block under the DEFAULT preset and
  // then restart it. allSettled, not all — an unconfigured or failing PWA read
  // must not hold back branding, which is what colours the login.
  React.useEffect(() => {
    paint(branding);
    Promise.allSettled([fetchBranding(), fetchPwaConfig()])
      .then(([b, p]) => {
        if (b.status === "fulfilled") {
          setState(b.value);
          paint(b.value);
        }
        if (p.status === "fulfilled" && p.value) setPwaState({ ...EMPTY_PWA_CONFIG, ...p.value });
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBranding = React.useCallback((b: Branding) => {
    setState(b);
    paint(b);
  }, []);

  const setPwaConfig = React.useCallback((c: PwaConfig) => {
    setPwaState({ ...EMPTY_PWA_CONFIG, ...c });
  }, []);

  // Resolved once per change rather than per consumer — the install banner, the
  // offline pill and the updater all read it on every render.
  const pwa = React.useMemo(() => effectivePwa(pwaConfig, brandSource(branding)), [pwaConfig, branding]);

  const value = React.useMemo(
    () => ({ branding, setBranding, ready, pwa, pwaConfig, setPwaConfig }),
    [branding, setBranding, ready, pwa, pwaConfig, setPwaConfig],
  );

  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export function useBranding() {
  const ctx = React.useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
