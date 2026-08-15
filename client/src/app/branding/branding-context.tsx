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
  applyPwaDocument,
  brandSource,
  effectivePwa,
  fetchPwaConfig,
  EMPTY_PWA_CONFIG,
  type EffectivePwa,
  type PwaConfig,
} from "@/lib/pwa-config";
import { loadFonts, DEFAULT_STACK, DEFAULT_MONO_STACK } from "@/lib/fonts";
import { EMPTY_USER_APPEARANCE, type UserAppearance } from "@/lib/preferences";
import { onReconnect } from "@/lib/connection";
import {
  readCachedBranding,
  writeCachedBranding,
  readCachedPwaConfig,
  writeCachedPwaConfig,
} from "@/lib/appearance-cache";

const DEFAULT_PRIMARY = import.meta.env.VITE_BRAND_PRIMARY || "#0f766e";

type Ctx = {
  branding: Branding;
  setBranding: (b: Branding) => void;
  /** The signed-in user's personal typography overrides (see lib/preferences). */
  userAppearance: UserAppearance;
  /** Applied on top of the tenant's fonts and repainted immediately. */
  setUserAppearance: (a: UserAppearance) => void;
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

const DEFAULT_BRANDING: Branding = {
  name: null,
  primary: DEFAULT_PRIMARY,
  primaryForeground: "#ffffff",
  logoUrl: null,
};

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  // Seed from the last identity the server gave us (appearance-cache) so an
  // OFFLINE boot paints the TENANT's colour, name and logo rather than the
  // build-time "Praxis LS" default. Null cache (first-ever visit) falls straight
  // back to the default, so nothing about the online first-run changes.
  const [branding, setState] = React.useState<Branding>(
    () => readCachedBranding() ?? DEFAULT_BRANDING,
  );
  const [pwaConfig, setPwaState] = React.useState<PwaConfig>(
    () => readCachedPwaConfig() ?? EMPTY_PWA_CONFIG,
  );
  const [userAppearance, setUserState] = React.useState<UserAppearance>(
    EMPTY_USER_APPEARANCE,
  );
  const [ready, setReady] = React.useState(false);

  // Each setter repaints BOTH layers, so each needs the other's current value.
  // Refs rather than effect dependencies: a repaint must happen at the moment
  // the save resolves, and reading the live ref keeps the two setters
  // independent of render timing — without them, saving branding would repaint
  // using whatever overrides were captured when the callback was created and
  // silently drop the user's fonts until the next reload.
  const brandingRef = React.useRef(branding);
  const userRef = React.useRef(userAppearance);

  // Fetch both public reads, then re-paint and re-CACHE with whatever the server
  // returned. Shared by boot and by the reconnect handler below, so the identity
  // that survives an offline stint is refreshed the instant the network is back.
  //
  // allSettled, not all — an unconfigured or failing PWA read must not hold back
  // branding, which is what colours the login. A rejected read is not an error
  // path: an unconfigured or OFFLINE tenant keeps whatever is already painted
  // (the cached identity, or the default before the first fetch ever succeeded).
  const loadAppearance = React.useCallback(() => {
    return Promise.allSettled([fetchBranding(), fetchPwaConfig()]).then(
      ([b, p]) => {
        if (b.status === "fulfilled") {
          brandingRef.current = b.value;
          setState(b.value);
          paint(b.value, userRef.current);
          writeCachedBranding(b.value);
        }
        if (p.status === "fulfilled" && p.value) {
          const cfg = { ...EMPTY_PWA_CONFIG, ...p.value };
          setPwaState(cfg);
          writeCachedPwaConfig(cfg);
        }
      },
    );
  }, []);

  // Paint the cached-or-default identity immediately, then fetch and re-paint
  // with the tenant's own.
  //
  // `ready` waits for the fetch to settle: the splash is already on screen and is
  // driven by the PWA config, so flipping ready before the reads resolve would
  // reveal the identity block under a stale preset and then restart it.
  React.useEffect(() => {
    paint(branding, userAppearance);
    loadAppearance().finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FULL RE-HYDRATE ON RECONNECT. The identity was fetched exactly once, at
  // boot, so a boot that happened OFFLINE left the app wearing the default until
  // a manual hard refresh — the "why do I have to Ctrl+F5" the offline story is
  // meant to close. Re-running the reads the moment the server answers again
  // repaints the real brand in place, with no reload and nothing yanked from a
  // user mid-task. (The query cache and the session re-hydrate on the same
  // signal — see connection-watcher.tsx and auth-context.tsx.)
  React.useEffect(
    () => onReconnect(() => void loadAppearance()),
    [loadAppearance],
  );

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

  const setPwaConfig = React.useCallback((c: PwaConfig) => {
    setPwaState({ ...EMPTY_PWA_CONFIG, ...c });
  }, []);

  // Resolved once per change rather than per consumer — the install banner, the
  // offline pill and the updater all read it on every render. Note it resolves
  // against the TENANT's branding, not the merged per-user layer: an installed
  // app's icon and splash are the company's identity, and one user's font
  // choice does not change what the operating system shows on a home screen.
  const pwa = React.useMemo(
    () => effectivePwa(pwaConfig, brandSource(branding)),
    [pwaConfig, branding],
  );

  /**
   * The installed app's document-level identity — the title-bar colour, its
   * artwork, and the iOS label. In an effect rather than inside `paint` because
   * it depends on the RESOLVED pwa config, which is derived from branding
   * rather than being branding.
   *
   * It also has to re-run on a THEME change, because the title bar tracks the
   * app's surface per theme. `lib/theme-mode.ts` publishes no change event — it
   * just toggles `.dark` on <html>, including when the OS preference moves
   * under a user on "system" — so this observes the class rather than making
   * the two modules import each other. One observer, no polling, and it catches
   * the OS-driven case that a click handler on the toggle would miss.
   */
  React.useEffect(() => {
    applyPwaDocument(pwa);
    const observer = new MutationObserver(() => applyPwaDocument(pwa));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [pwa]);

  // PERF S14: the provider value is memoised deliberately. An inline object
  // literal is a NEW context identity on every render, so every consumer in the
  // tree re-renders whether or not anything changed — and with no React.memo
  // across the component set there is nothing to arrest the cascade. Every
  // setter below is a stable useCallback so this identity changes only when the
  // branding, appearance or PWA state actually does.
  const value = React.useMemo(
    () => ({
      branding,
      setBranding,
      userAppearance,
      setUserAppearance,
      ready,
      pwa,
      pwaConfig,
      setPwaConfig,
    }),
    [
      branding,
      setBranding,
      userAppearance,
      setUserAppearance,
      ready,
      pwa,
      pwaConfig,
      setPwaConfig,
    ],
  );

  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

export function useBranding() {
  const ctx = React.useContext(BrandingCtx);
  if (!ctx) throw new Error("useBranding must be used within BrandingProvider");
  return ctx;
}
