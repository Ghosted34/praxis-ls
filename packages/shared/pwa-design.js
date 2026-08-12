"use strict";
/**
 * The installed-app (PWA) design contract — shared by the API and the client.
 *
 * WHY THIS IS SHARED AND NOT DUPLICATED. Two programs render the same thing
 * from the same settings: the API renders the PNG that Android and iOS mask onto
 * a home screen (`src/routes/pwa.js`, via sharp), and the client renders the
 * preview the tenant looks at before clicking Save (`features/settings/pwa/`).
 * If the two disagreed about a single default — what an unset icon background
 * is, how much safe-zone padding a maskable icon gets, which brand field an
 * unset app name falls back to — the preview would be a lie, and the only place
 * anyone would find out is on a real phone after install.
 *
 * So the fallback rules, the defaults, the enums and the slider ranges live
 * here, once. `effectivePwa()` is the whole resolution: raw settings in
 * (null = "inherit"), concrete values out.
 *
 * CommonJS with named `exports.x =` assignments, like index.js — see the note
 * there about cjs-module-lexer and the client bundle.
 */

/** Closed sets. A value outside these is rejected by the API (422) rather than
 *  coerced: the client switches on them, so an unknown member is a bug. */
const PWA_ENUMS = {
  display: ["standalone", "fullscreen", "minimal-ui", "browser"],
  orientation: ["any", "portrait", "landscape"],
  splashPreset: ["none", "fade", "pulse", "shimmer", "ring", "mesh"],
  titlebarMode: ["surface", "brand", "custom"],
};

/**
 * [min, max] for the numeric transform fields, in the units the editor shows
 * (percent, except splashDuration in ms). Clamped rather than rejected — these
 * come from sliders, and one step past the end is not worth failing a save for.
 */
const PWA_RANGES = {
  iconPadding: [0, 30],
  iconZoom: [50, 200],
  iconOffsetX: [-50, 50],
  iconOffsetY: [-50, 50],
  iconRadius: [0, 50],
  maskablePadding: [10, 35],
  splashDuration: [0, 4000],
  titlebarImageOpacity: [0, 60],
  titlebarBlur: [0, 24],
};

const PWA_BOOLS = ["splashEnabled", "splashShowProgress", "installEnabled"];

/** Free-text caps. `shortName` is 12 because that is about what a home-screen
 *  label renders before the OS truncates it. */
const PWA_TEXT_MAX = { appName: 60, shortName: 12, description: 300 };
const PWA_TEXT_DEFAULT_MAX = 200;

/** What the app uses when a field is unset and has no brand field to inherit. */
const PWA_DEFAULTS = {
  display: "standalone",
  orientation: "any",
  iconBackground: "#ffffff",
  iconPadding: 8,
  iconZoom: 100,
  iconOffsetX: 0,
  iconOffsetY: 0,
  iconRadius: 22,
  maskablePadding: 20,
  splashEnabled: true,
  splashPreset: "fade",
  splashDuration: 600,
  splashTagline: "LOADING YOUR WORKSPACE",
  splashShowProgress: true,
  installEnabled: true,
  titlebarMode: "surface",
  titlebarLight: "#ffffff",
  titlebarDark: "#12161e",
  titlebarImageOpacity: 18,
  titlebarBlur: 0,
};

/** The dark plate the boot splash falls back to when no colour is chosen. It is
 *  deliberately NOT the app background: the splash fades into the app, and a
 *  near-black plate reads as "the app is starting" in either theme. */
const SPLASH_FALLBACK_BG = "#0b0f10";

/**
 * The installed window's title bar.
 *
 * WHAT WINDOW-CONTROLS-OVERLAY ACTUALLY CHANGES. With `display_override:
 * ["window-controls-overlay"]` the operating system stops drawing a title bar
 * and hands that strip to the page. So the bar becomes ordinary HTML — it can
 * carry the logo, search, anything — and `theme_color` shrinks to painting only
 * the small area behind the minimise/maximise/close buttons, which the page is
 * not allowed to draw in.
 *
 * That split is why these two values must agree. The page paints
 * `titlebar.base` (plus any artwork over it); the OS paints `theme_color`
 * beside the caption buttons. Set them independently and there is a visible
 * seam a few hundred pixels from the right edge of the window, which is exactly
 * the "bolted-on" look the whole exercise is trying to remove.
 *
 * MODES. `surface` (the default) tracks the app's own card surface per theme,
 * so the window reads as one continuous instrument. `brand` is the old
 * behaviour — the accent, which as a full-width window frame is very loud.
 * `custom` is two explicit hexes, one per theme, because a single value cannot
 * serve both and a light bar on a dark app is the thing to avoid.
 */
const TITLEBAR_MODES = ["surface", "brand", "custom"];

/** Mirrors `--card` in client/src/index.css. Duplicated rather than read from
 *  the stylesheet because the API renders a manifest with no DOM at all. */
const SURFACE_LIGHT = "#ffffff";
const SURFACE_DARK = "#12161e";

/**
 * Resolve the title bar for ONE theme. Called with the live theme in the
 * browser (so the bar follows a light/dark toggle immediately) and with the
 * tenant's default theme on the server (so the manifest declares something
 * sensible before any of our code runs).
 *
 * @param {object} cfg   effectivePwa() output
 * @param {"dark"|"light"} theme
 */
function resolveTitlebar(cfg, theme) {
  const dark = theme === "dark";
  let base;
  if (cfg.titlebarMode === "brand") base = cfg.themeColor;
  else if (cfg.titlebarMode === "custom")
    base = dark ? cfg.titlebarDark : cfg.titlebarLight;
  else base = dark ? SURFACE_DARK : SURFACE_LIGHT;

  return {
    base,
    imageUrl: cfg.titlebarImageUrl || null,
    // Artwork in a title bar is texture, not decoration — it has to survive
    // small text sitting on top of it, so the opacity ceiling is low by design.
    opacity: Math.min(60, Math.max(0, Number(cfg.titlebarImageOpacity))) / 100,
    blur: Math.min(24, Math.max(0, Number(cfg.titlebarBlur))),
  };
}

const pick = (val, fallback) =>
  val === null || val === undefined || val === "" ? fallback : val;
const bool = (val, fallback) =>
  val === null || val === undefined ? fallback : Boolean(val);
const clamp = (n, [min, max]) => Math.min(max, Math.max(min, n));

/**
 * Collapse {raw pwa settings, raw branding} into the concrete values every
 * consumer uses.
 *
 * @param {object|null} pwa   raw `setting` section='pwa' map (nulls = inherit)
 * @param {object|null} brand raw `setting` section='appearance' map
 */
function effectivePwa(pwa, brand) {
  const p = pwa || {};
  const b = brand || {};

  const name = pick(p.appName, pick(b.name, "Praxis LS"));
  const primary = pick(p.themeColor, pick(b.primary, "#F5821F"));
  // The launch background follows the tenant's theme mode unless overridden, so
  // the splash doesn't flash the wrong colour before the SPA paints. Mirrors the
  // `--background` token in client/src/index.css.
  const themedBg = b.theme === "dark" ? "#071324" : "#f3f6fb";

  return {
    // manifest identity
    name,
    shortName: String(pick(p.shortName, name)).slice(0, 12),
    description: pick(
      p.description,
      name + " — logistics & accounting platform",
    ),
    display: pick(p.display, PWA_DEFAULTS.display),
    orientation: pick(p.orientation, PWA_DEFAULTS.orientation),
    themeColor: primary,
    backgroundColor: pick(p.backgroundColor, themedBg),

    // icon — a dedicated square upload if there is one, else the brand logo
    iconUrl: pick(p.iconUrl, pick(b.logoUrl, null)),
    iconBackground: pick(p.iconBackground, PWA_DEFAULTS.iconBackground),
    iconPadding: Number(pick(p.iconPadding, PWA_DEFAULTS.iconPadding)),
    iconZoom: Number(pick(p.iconZoom, PWA_DEFAULTS.iconZoom)),
    iconOffsetX: Number(pick(p.iconOffsetX, PWA_DEFAULTS.iconOffsetX)),
    iconOffsetY: Number(pick(p.iconOffsetY, PWA_DEFAULTS.iconOffsetY)),
    iconRadius: Number(pick(p.iconRadius, PWA_DEFAULTS.iconRadius)),
    // A maskable icon is cropped by the launcher, so it must be opaque edge to
    // edge — a transparent one shows the wallpaper through the corners. It
    // inherits the BRAND colour, not the plain icon's background, which is
    // usually white and would read as a missing icon on a light launcher.
    maskableBackground: pick(p.maskableBackground, primary),
    maskablePadding: Number(
      pick(p.maskablePadding, PWA_DEFAULTS.maskablePadding),
    ),

    // boot splash
    splashEnabled: bool(p.splashEnabled, PWA_DEFAULTS.splashEnabled),
    splashPreset: pick(p.splashPreset, PWA_DEFAULTS.splashPreset),
    splashDuration: Number(pick(p.splashDuration, PWA_DEFAULTS.splashDuration)),
    splashBackground: pick(p.splashBackground, SPLASH_FALLBACK_BG),
    splashTagline: pick(p.splashTagline, PWA_DEFAULTS.splashTagline),
    splashShowProgress: bool(
      p.splashShowProgress,
      PWA_DEFAULTS.splashShowProgress,
    ),
    // The splash shows the app icon when one is set, so what the tenant sees on
    // boot matches what they installed; the wordmark logo is the fallback.
    splashLogoUrl: pick(p.iconUrl, pick(b.logoUrl, null)),

    // installed window title bar (window-controls-overlay)
    titlebarMode: pick(p.titlebarMode, PWA_DEFAULTS.titlebarMode),
    titlebarLight: pick(p.titlebarLight, PWA_DEFAULTS.titlebarLight),
    titlebarDark: pick(p.titlebarDark, PWA_DEFAULTS.titlebarDark),
    titlebarImageUrl: pick(p.titlebarImageUrl, null),
    titlebarImageOpacity: Number(
      pick(p.titlebarImageOpacity, PWA_DEFAULTS.titlebarImageOpacity),
    ),
    titlebarBlur: Number(pick(p.titlebarBlur, PWA_DEFAULTS.titlebarBlur)),

    // install / offline / update copy — null means "use the built-in string",
    // which is localised in the component rather than stored per tenant.
    installEnabled: bool(p.installEnabled, PWA_DEFAULTS.installEnabled),
    installTitle: pick(p.installTitle, null),
    installBody: pick(p.installBody, null),
    installIosBody: pick(p.installIosBody, null),
    installButton: pick(p.installButton, null),
    offlineText: pick(p.offlineText, null),
    offlineReadyText: pick(p.offlineReadyText, null),
    updateTitle: pick(p.updateTitle, null),
    updateBody: pick(p.updateBody, null),
    updateButton: pick(p.updateButton, null),
  };
}

/**
 * Where the artwork actually lands inside the icon canvas, as fractions of the
 * canvas (0..1). The API composites with sharp and the client draws a preview in
 * CSS; both need the same arithmetic, and "the preview is a few pixels off" is
 * indistinguishable from "the safe-zone warning is wrong".
 *
 * @param {object} cfg      effectivePwa() output
 * @param {boolean} maskable maskable variant (uses the safe-zone padding)
 * @returns {{size:number,left:number,top:number}} artwork box, canvas fractions
 */
function iconLayout(cfg, maskable) {
  const padPct = maskable ? cfg.maskablePadding : cfg.iconPadding;
  const box = 1 - (padPct / 100) * 2;
  const size = box * (cfg.iconZoom / 100);
  return {
    size,
    left: (1 - size) / 2 + cfg.iconOffsetX / 100,
    top: (1 - size) / 2 + cfg.iconOffsetY / 100,
  };
}

exports.PWA_ENUMS = PWA_ENUMS;
exports.PWA_RANGES = PWA_RANGES;
exports.PWA_BOOLS = PWA_BOOLS;
exports.PWA_TEXT_MAX = PWA_TEXT_MAX;
exports.PWA_TEXT_DEFAULT_MAX = PWA_TEXT_DEFAULT_MAX;
exports.PWA_DEFAULTS = PWA_DEFAULTS;
exports.SPLASH_FALLBACK_BG = SPLASH_FALLBACK_BG;
exports.TITLEBAR_MODES = TITLEBAR_MODES;
exports.SURFACE_LIGHT = SURFACE_LIGHT;
exports.SURFACE_DARK = SURFACE_DARK;
exports.resolveTitlebar = resolveTitlebar;
exports.effectivePwa = effectivePwa;
exports.iconLayout = iconLayout;
exports.clamp = clamp;
