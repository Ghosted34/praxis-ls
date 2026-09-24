/**
 * Chat appearance — the per-device wallpaper and brand-accent store + hook.
 *
 * Logic only, no JSX (the control lives in chat-appearance.tsx). Split out so
 * the component file exports only components (react-refresh).
 *
 * ── WHY PER-DEVICE, AND WHY localStorage ──────────────────────────────────
 *
 * The WhatsApp "chat wallpaper" model: a personal preference for the device you
 * read on, not a tenant-wide setting. So it lives in localStorage — no backend
 * column, no migration — and the image is compressed to a data URL (a vault URL
 * could not be a CSS `background-image`: it needs a Bearer token `url()` cannot
 * carry).
 *
 * ── THE ACCENT STAYS INSIDE THE BRAND, AND STAYS READABLE ─────────────────
 *
 * The swatches are ONLY the tenant's own brand colours. Picking one overrides
 * `--primary`, `--primary-ink`, `--primary-foreground` and `--ring` on the chat
 * shell alone, so every chat tint recolours at once. The ink is derived with the
 * SAME `toAccessibleInk` the theme uses (never a second copy), so small type
 * stays AA on whichever surface, in either theme.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useBranding } from "@/app/branding/branding-context";
import { parseHex, labelOn, toAccessibleInk, type Rgb } from "@/lib/theme";
import type { Branding } from "@/lib/branding";

const ACCENT_KEY = "comms:chat-accent";
const WALLPAPER_KEY = "comms:chat-wallpaper";

/** The neutral surfaces the ink must clear, per theme. These mirror the fixed
 *  design tokens in index.css (`--background` / `--card`); they are not
 *  tenant-brandable, so hard-coding them keeps the derivation off the paint. */
const LIGHT_SURFACES: Rgb[] = [
  [243, 246, 251],
  [255, 255, 255],
];
const DARK_SURFACES: Rgb[] = [
  [11, 13, 17],
  [18, 22, 30],
];

const rgbCss = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

/* ── the store: one source of truth, shared by every call site ────────────── */

type ApState = { accent: string | null; wallpaper: string | null };

function readInitial(): ApState {
  try {
    return {
      accent: localStorage.getItem(ACCENT_KEY),
      wallpaper: localStorage.getItem(WALLPAPER_KEY),
    };
  } catch {
    /* @silent:storage — a private window or blocked storage; the defaults hold. */
    return { accent: null, wallpaper: null };
  }
}

let state: ApState = readInitial();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => state;

function setAccent(accent: string | null) {
  state = { ...state, accent };
  try {
    if (accent) localStorage.setItem(ACCENT_KEY, accent);
    else localStorage.removeItem(ACCENT_KEY);
  } catch {
    /* @silent:storage — the choice still applies for this session. */
  }
  emit();
}

/** Returns false when the image could not be persisted (quota), so the caller
 *  can say so rather than showing a wallpaper that vanishes on reload. */
function setWallpaper(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(WALLPAPER_KEY, dataUrl);
    else localStorage.removeItem(WALLPAPER_KEY);
  } catch {
    /* @silent:storage — quota exceeded; do not apply an unsaved wallpaper. */
    return false;
  }
  state = { ...state, wallpaper: dataUrl };
  emit();
  return true;
}

/* ── theme awareness (the ink is theme-specific) ──────────────────────────── */

function useIsDark(): boolean {
  const [dark, setDark] = React.useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  React.useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export type Swatch = { name: string; value: string; rgb: Rgb };

/** The brand's own colours, de-duplicated, minus the one that equals primary
 *  (that is the "Default" choice). Only what the brand already defines. */
function buildSwatches(branding: Branding | null): Swatch[] {
  if (!branding) return [];
  const primaryRgb = branding.primary ? parseHex(branding.primary) : null;
  const raw: Array<{ name: string; value?: string | null }> = [
    { name: tr("Secondary"), value: branding.secondary },
    { name: tr("Accent"), value: branding.accent },
    { name: tr("Deep"), value: branding.accentDeep },
  ];
  const seen = new Set<string>(primaryRgb ? [primaryRgb.join(",")] : []);
  const out: Swatch[] = [];
  for (const s of raw) {
    const v = (s.value || "").trim();
    if (!v) continue;
    const rgb = parseHex(v);
    if (!rgb) continue;
    const key = rgb.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: s.name, value: v, rgb });
  }
  return out;
}

/* ── the hook the page uses ───────────────────────────────────────────────── */

export type ChatAppearance = {
  accent: string | null;
  wallpaper: string | null;
  hasCustomWallpaper: boolean;
  swatches: Swatch[];
  shellStyle: React.CSSProperties;
  setAccent: (accent: string | null) => void;
  setWallpaper: (dataUrl: string | null) => boolean;
  clearWallpaper: () => void;
};

export function useChatAppearance(): ChatAppearance {
  const store = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const dark = useIsDark();
  const { branding } = useBranding();

  const swatches = React.useMemo(() => buildSwatches(branding), [branding]);

  const shellStyle = React.useMemo<React.CSSProperties>(() => {
    const rgb = store.accent ? parseHex(store.accent) : null;
    if (!rgb) return {};
    const ink = toAccessibleInk(rgb, dark ? DARK_SURFACES : LIGHT_SURFACES);
    return {
      "--primary": rgbCss(rgb),
      "--primary-ink": rgbCss(ink),
      "--primary-foreground": labelOn(store.accent) || "rgb(10 10 10)",
      "--ring": rgbCss(rgb),
    } as React.CSSProperties;
  }, [store.accent, dark]);

  // The stored per-device wallpaper wins; a tenant hero image is the fallback.
  const wallpaper = store.wallpaper || branding?.hero?.imageUrl || null;

  return {
    accent: store.accent,
    wallpaper,
    hasCustomWallpaper: !!store.wallpaper,
    swatches,
    shellStyle,
    setAccent,
    setWallpaper,
    clearWallpaper: () => setWallpaper(null),
  };
}
