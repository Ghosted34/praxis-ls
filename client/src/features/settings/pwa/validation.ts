/**
 * Installability and legibility checks for the App & PWA editor.
 *
 * THESE WARN; THEY DO NOT BLOCK. Deliberate, and worth stating because the
 * opposite is the tempting default. The API never ships a broken manifest — an
 * unreadable icon falls back to a brand monogram, a missing name to the tenant
 * slug — so nothing here can make the app uninstallable. What these catch is the
 * gap between "valid" and "good": an icon that is technically fine and loses its
 * descender to a circular crop, a splash whose progress bar is invisible against
 * its own background. That is a judgement about a brand, and the tenant owns
 * their brand. Some marks genuinely are designed to bleed past the safe zone.
 *
 * So each check states the consequence in terms of what the user will SEE on a
 * device, and the editor draws the same fact next to it (the safe-zone circle,
 * the three launcher masks). A warning nobody can act on is noise; a warning
 * next to a picture of the problem is a decision.
 */
import { contrast, parseHex } from "@/lib/theme";
import { iconLayout, type EffectivePwa } from "@/lib/pwa-config";

export type PwaWarning = {
  id: string;
  tone: "warn" | "info";
  title: string;
  detail: string;
};

/** Natural pixel dimensions of the uploaded source, once the browser has it. */
export type SourceMeta = { width: number; height: number } | null;

/** Chrome/Edge require a 512px icon for the install prompt and the splash. */
const MIN_SOURCE_PX = 512;
/** Beyond this the source is meaningfully non-square and `contain` will letterbox. */
const SQUARE_TOLERANCE = 1.02;
/** Below this the accent stops reading against the splash plate. */
const MIN_ACCENT_CONTRAST = 1.6;

/**
 * Does the artwork box escape the maskable safe zone?
 *
 * The zone is defined as the centre circle of diameter 80%, but this measures
 * against the 80% SQUARE, and the difference is the whole judgement call.
 *
 * A square icon's corners are always slightly outside a circle of the same
 * width — at the platform's own recommended 20% padding, a full-bleed square
 * artwork reaches 0.424 from centre against the circle's 0.4. Measured against
 * the circle, therefore, this check would fire on the recommended default, on
 * every tenant, on first open. A warning that is on by default is not a warning;
 * it is a permanent piece of furniture that teaches people to ignore the panel
 * it lives in.
 *
 * Against the square it fires on what it is actually for: artwork zoomed or
 * nudged past the region launchers keep. The residual risk — a mark whose
 * literal corners get shaved on a circular crop — is the one thing the tenant
 * can see for themselves, because the editor draws the circle over the icon.
 */
export function escapesSafeZone(cfg: EffectivePwa): boolean {
  const { size, left, top } = iconLayout(cfg, true);
  const epsilon = 0.001; // the recommended default lands exactly on the boundary
  return left < 0.1 - epsilon || top < 0.1 - epsilon || left + size > 0.9 + epsilon || top + size > 0.9 + epsilon;
}

export function iconWarnings(cfg: EffectivePwa, source: SourceMeta): PwaWarning[] {
  const out: PwaWarning[] = [];

  if (!cfg.iconUrl) {
    out.push({
      id: "no-icon",
      tone: "info",
      title: "No app icon set",
      detail:
        "The home-screen icon falls back to a letter mark on your brand colour. That installs fine — upload a square image to replace it.",
    });
    return out; // the checks below are all about a source that isn't there
  }

  if (source) {
    const ratio = Math.max(source.width / source.height, source.height / source.width);
    if (ratio > SQUARE_TOLERANCE) {
      out.push({
        id: "not-square",
        tone: "warn",
        title: "The source image isn't square",
        detail: `It's ${source.width}×${source.height}. App icons are square, so it will be fitted inside one with empty space on two sides — a wide wordmark ends up as a thin strip in the middle of the tile.`,
      });
    }
    if (Math.min(source.width, source.height) < MIN_SOURCE_PX) {
      out.push({
        id: "too-small",
        tone: "warn",
        title: `Smaller than ${MIN_SOURCE_PX}px`,
        detail: `It's ${source.width}×${source.height}. Chrome needs a 512px icon to offer the install prompt, and it's also what the launch screen scales up — below that it will look soft.`,
      });
    }
  }

  if (escapesSafeZone(cfg)) {
    out.push({
      id: "safe-zone",
      tone: "warn",
      title: "Artwork reaches outside the maskable safe zone",
      detail:
        "Android crops the icon to the launcher's shape — a circle on Pixel, a squircle on Samsung. Anything outside the dashed circle may be cut off. Raise the safe-zone padding, or reduce the zoom.",
    });
  }

  if (cfg.iconBackground === "transparent") {
    out.push({
      id: "transparent-plain",
      tone: "info",
      title: "The plain icon is transparent",
      detail:
        "That's fine on iOS and on desktop. The maskable variant is still filled with your brand colour, because a transparent maskable icon shows the wallpaper through the crop.",
    });
  }

  const bg = parseHex(cfg.maskableBackground);
  const plain = cfg.iconBackground === "transparent" ? null : parseHex(cfg.iconBackground);
  if (bg && plain && contrast(bg, plain) < 1.1) {
    out.push({
      id: "same-backgrounds",
      tone: "info",
      title: "Both icon backgrounds are the same colour",
      detail: "Not a problem — just confirming the maskable variant won't look different from the plain one.",
    });
  }

  return out;
}

export function splashWarnings(cfg: EffectivePwa): PwaWarning[] {
  const out: PwaWarning[] = [];
  if (!cfg.splashEnabled) return out;

  const bg = parseHex(cfg.splashBackground);
  const accent = parseHex(cfg.themeColor);
  if (bg && accent && contrast(bg, accent) < MIN_ACCENT_CONTRAST) {
    out.push({
      id: "splash-accent",
      tone: "warn",
      title: "Your brand colour barely shows on the splash background",
      detail:
        "The progress bar, the glow and the ring preset are all drawn in the brand colour. Against this background they'll be close to invisible — pick a different splash background, or a preset that doesn't rely on the accent.",
    });
  }

  if (cfg.splashDuration < 300 && cfg.splashPreset !== "none") {
    out.push({
      id: "splash-too-short",
      tone: "info",
      title: "The splash may lift before the animation finishes",
      detail: `It's set to hold for ${cfg.splashDuration}ms, and it lifts as soon as boot finishes after that. On a warm cache the animation will be cut short.`,
    });
  }

  if (cfg.splashDuration > 2000) {
    out.push({
      id: "splash-too-long",
      tone: "warn",
      title: "That's a long hold",
      detail: `${(cfg.splashDuration / 1000).toFixed(1)}s of waiting on every launch, even when the app is ready sooner. Staff open this many times a day.`,
    });
  }

  return out;
}

export function manifestWarnings(cfg: EffectivePwa): PwaWarning[] {
  const out: PwaWarning[] = [];
  if (cfg.display === "browser") {
    out.push({
      id: "display-browser",
      tone: "warn",
      title: "Display mode 'browser' is not installable",
      detail:
        "Chrome and Edge won't offer the install prompt for a manifest in browser mode — the app opens as a normal tab. Use standalone unless you specifically want that.",
    });
  }
  if (cfg.name.length > 30) {
    out.push({
      id: "long-name",
      tone: "info",
      title: "Long app name",
      detail: "The full name shows in the install dialog and app settings. The short name is what a home screen shows.",
    });
  }
  return out;
}
