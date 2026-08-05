/**
 * Per-tenant PWA surface. Subdomain-per-tenant means every workspace is its own
 * origin, so the web-app manifest and its icons can be resolved from the Host
 * and built live from that tenant's own configuration:
 *   GET /manifest.webmanifest        identity, display mode, colours
 *   GET /icons/app-icon-<size>.png   the tenant's app icon, transformed
 *   GET /icons/app-icon-maskable-512.png  maskable variant (safe-zone padded)
 *
 * WHERE THE VALUES COME FROM. `setting` section='pwa' (the App & PWA editor),
 * falling back to section='appearance' (the brand) for anything unset — one
 * resolver, `brandingService.effectivePwa`, shared with the client so the PNG a
 * device masks and the preview the tenant approved cannot disagree.
 *
 * TENANT ISOLATION. Nothing here takes a tenant id from the request body or
 * query: `hostTenantResolver` derives it from the Host header alone, and the
 * read runs inside `withTenantConnection` (that tenant's schema). Icon bytes are
 * loaded by a storage key that the tenant's own `tenant_<slug>/` namespace
 * produced, and the in-process icon cache is keyed by slug, so one tenant's
 * icon can be neither read nor served under another's origin.
 *
 * READS `live`, ALWAYS. A device fetching a manifest sends no environment
 * header, and an installed app's identity is not a thing anyone should be able
 * to change from a sandbox experiment.
 *
 * All three routes are PUBLIC and never throw: an unknown/platform host, an
 * unconfigured tenant, or an unreadable icon all fall back to generic Praxis
 * defaults so "Add to home screen" always works. Icons are cached in-process
 * (rendered PNG, keyed by the full transform) and via Cache-Control.
 */
"use strict";

const express = require("express");
const crypto = require("crypto");
const sharp = require("sharp");
const { hostTenantResolver } = require("../middleware/host-tenent-resolver");
const { asyncHandler } = require("../utils/errors");
const registry = require("../services/tenant/registry.service");
const storage = require("../services/storage.service");
const brandingService = require("../modules/branding/branding.service");

const DEFAULTS = { name: "Praxis LS", primary: "#F5821F" };

// Small bounded in-process cache for rendered icons (keyed by tenant + variant +
// the whole transform, so a slider move invalidates it).
const ICON_CACHE = new Map();
const ICON_CACHE_MAX = 64;
function iconCacheGet(key) {
  return ICON_CACHE.get(key) || null;
}
function iconCacheSet(key, buf) {
  if (ICON_CACHE.size >= ICON_CACHE_MAX) ICON_CACHE.delete(ICON_CACHE.keys().next().value);
  ICON_CACHE.set(key, buf);
}
/** Exported for tests — the cache is process-global and would otherwise leak
 *  one case's render into the next. */
function clearIconCache() {
  ICON_CACHE.clear();
}

/**
 * Resolve the tenant's effective PWA config, never throwing. Both settings
 * sections are read on ONE connection: the manifest is on the critical path of
 * every install and every cold start.
 */
async function resolvePwaConfig(req) {
  const slug = (req.tenant && req.tenant.slug) || "platform";
  const fallback = () => ({
    slug,
    brandTheme: "light",
    ...brandingService.effectivePwa(null, { name: req.tenant ? slug : DEFAULTS.name, primary: DEFAULTS.primary }),
  });
  if (!req.tenant) return fallback();
  try {
    const { brand, pwa } = await registry.withTenantConnection(req.tenant, "live", async (c) => ({
      brand: await brandingService.getBranding(c),
      pwa: await brandingService.getPwa(c),
    }));
    // `brandTheme` rides along so the manifest can resolve the title bar for
    // the tenant's default theme — it is read before any of our code runs, so
    // there is no live theme to ask.
    return {
      slug,
      brandTheme: brand.theme === "dark" ? "dark" : "light",
      ...brandingService.effectivePwa(pwa, { ...brand, name: brand.name || slug }),
    };
  } catch {
    return fallback();
  }
}

/** Load the icon bytes from storage, or null (any failure → monogram). */
async function loadIcon(iconUrl) {
  if (!iconUrl || typeof iconUrl !== "string") return null;
  const key = iconUrl.replace(/^https?:\/\/[^/]+/, "").replace(/^\/media\//, "").replace(/^\//, "");
  if (!key) return null;
  try {
    return await storage.get(key);
  } catch {
    return null;
  }
}

function monogramLetter(cfg) {
  const src = String(cfg.shortName || cfg.name || "P").trim();
  const ch = src.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(ch) ? ch : "P";
}

const isTransparent = (c) => !c || String(c).toLowerCase() === "transparent";

/**
 * Clip a scaled icon to the part of it that actually lands on the canvas.
 *
 * Zoom goes to 200% and the offsets to ±50%, so the artwork routinely extends
 * past the edge — which is a legitimate design (a mark bled to the corners),
 * but sharp refuses to composite an input larger than its canvas or positioned
 * outside it. Cropping to the intersection makes the overflow render the way the
 * editor previews it (clipped) instead of failing the request.
 *
 * @returns a sharp composite entry, or null when nothing is left on canvas.
 */
async function clipToCanvas(buf, scaled, left, top, px) {
  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const width = Math.min(scaled - cropLeft, px - Math.max(0, left));
  const height = Math.min(scaled - cropTop, px - Math.max(0, top));
  if (width <= 0 || height <= 0) return null; // pushed entirely off the canvas

  let input = buf;
  if (cropLeft || cropTop || width !== scaled || height !== scaled) {
    input = await sharp(buf).extract({ left: cropLeft, top: cropTop, width, height }).png().toBuffer();
  }
  return { input, left: Math.max(0, left), top: Math.max(0, top) };
}

/**
 * Render a size×size PNG app icon from the tenant's source image, applying the
 * editor's transform — or a brand-coloured monogram when there is no image.
 *
 * `maskable` switches to the variant the OS is allowed to crop: the tenant's
 * safe-zone padding (default 20%), an opaque background edge to edge, and no
 * corner rounding — the launcher supplies the shape.
 */
async function renderIcon({ size, maskable, cfg, logoBuf }) {
  const px = Math.min(1024, Math.max(48, Number(size) || 192));
  const bg = maskable ? cfg.maskableBackground : cfg.iconBackground;
  const padPct = maskable ? cfg.maskablePadding : cfg.iconPadding;
  const radiusPct = maskable ? 0 : cfg.iconRadius;

  // Background plate. Transparent is only honoured for the plain icon; a
  // transparent maskable would show the launcher wallpaper through the crop.
  const transparent = isTransparent(bg) && !maskable;
  const plate = transparent
    ? sharp({ create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">` +
            `<rect width="${px}" height="${px}" rx="${Math.round((px * radiusPct) / 100)}" ` +
            `ry="${Math.round((px * radiusPct) / 100)}" fill="${bg}"/></svg>`,
        ),
      );

  if (logoBuf) {
    const pad = Math.round((px * padPct) / 100);
    const box = Math.max(1, px - pad * 2);
    const scaled = Math.max(1, Math.round((box * cfg.iconZoom) / 100));
    const resized = await sharp(logoBuf)
      .resize(scaled, scaled, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const left = Math.round((px - scaled) / 2 + (px * cfg.iconOffsetX) / 100);
    const top = Math.round((px - scaled) / 2 + (px * cfg.iconOffsetY) / 100);
    const entry = await clipToCanvas(resized, scaled, left, top, px);
    return plate
      .composite(entry ? [entry] : [])
      .png()
      .toBuffer();
  }

  // No icon and no logo — a monogram on the brand colour. Still the tenant's
  // identity, and still installable, which a missing icon would not be.
  const letter = monogramLetter(cfg);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `<rect width="${px}" height="${px}" rx="${Math.round((px * radiusPct) / 100)}" ` +
      `ry="${Math.round((px * radiusPct) / 100)}" fill="${cfg.themeColor}"/>` +
      // Library face over a generic keyword — "Arial" was named here and is not
      // one of ours. This is rasterised by sharp/librsvg against the fonts
      // installed in the container, so a single monogram letter is all it is
      // asked to do and the generic fallback is an acceptable outcome.
      `<text x="50%" y="50%" font-family="Montserrat, sans-serif" font-size="${Math.round(px * 0.5)}" ` +
      `font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${letter}</text>` +
      `</svg>`,
  );
  return sharp(svg).png().toBuffer();
}

/**
 * A short fingerprint of everything that changes the rendered bytes.
 *
 * THIS IS WHAT MAKES A NEW ICON REACH A DEVICE. The icon paths are fixed
 * (`/icons/app-icon-192.png`), so without a version in the URL a changed icon is
 * invisible to every cache between here and the launcher: the bytes at that URL
 * changed, but nothing had any reason to ask again. The manifest carries this as
 * `?v=`, so saving a new icon changes the manifest (short TTL), which yields URLs
 * nothing has ever seen, which are fetched immediately — and lets the icons
 * themselves be cached hard, because now they really are immutable.
 *
 * It does NOT fix an already-installed desktop app: Chrome and Edge write the
 * icon into the OS shortcut at install time and do not revisit it, so an
 * existing desktop installation needs reinstalling once. Android regenerates its
 * icon from the manifest, so it picks this up on its own.
 */
function iconVersion(cfg) {
  const transform = [
    cfg.iconUrl,
    cfg.iconBackground,
    cfg.iconPadding,
    cfg.iconZoom,
    cfg.iconOffsetX,
    cfg.iconOffsetY,
    cfg.iconRadius,
    cfg.maskableBackground,
    cfg.maskablePadding,
    cfg.themeColor,
    cfg.shortName,
  ].join("|");
  return crypto.createHash("sha1").update(transform).digest("hex").slice(0, 12);
}

function iconCacheKey(cfg, size, maskable) {
  return `${cfg.slug}:${size}:${maskable ? "m" : "a"}:${iconVersion(cfg)}`;
}

async function iconHandler(req, res, size, maskable) {
  const cfg = await resolvePwaConfig(req);
  const key = iconCacheKey(cfg, size, maskable);
  let png = iconCacheGet(key);
  if (!png) {
    const logoBuf = await loadIcon(cfg.iconUrl);
    png = await renderIcon({ size, maskable, cfg, logoBuf });
    iconCacheSet(key, png);
  }
  res.type("image/png");
  // Cached hard, because the manifest addresses these with a `?v=` fingerprint
  // (iconVersion) — a design change produces a URL nothing has seen rather than
  // a stale hit on this one. A request WITHOUT a version is someone (or some
  // cache) holding an old link, so it gets a short TTL instead.
  res.set("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=300");
  res.send(png);
}

const router = express.Router();

router.get(
  "/manifest.webmanifest",
  hostTenantResolver,
  asyncHandler(async (req, res) => {
    const cfg = await resolvePwaConfig(req);
    const v = iconVersion(cfg);
    const titlebar = brandingService.resolveTitlebar(cfg, cfg.brandTheme);
    const manifest = {
      // `id` is what the browser uses to decide whether this is the SAME app it
      // already installed. It must stay "/" through every design change —
      // versioning it would make every save look like a brand-new app and
      // orphan the installed one.
      id: "/",
      name: cfg.name,
      short_name: cfg.shortName,
      description: cfg.description,
      start_url: "/",
      scope: "/",
      display: cfg.display,
      /**
       * WINDOW CONTROLS OVERLAY. Asks the OS to stop drawing a title bar and
       * hand that strip to the page, which is what lets the app carry its own
       * brand row, search and environment toggle up there instead of wasting a
       * band of chrome on a duplicate of the window title.
       *
       * `display_override` is a PREFERENCE LIST, and `display` below stays as
       * the floor: a browser that does not implement WCO (every mobile one, and
       * desktop Safari) falls straight through to standalone and loses nothing.
       * That is also why the CSS uses `env(titlebar-area-*)` with fallbacks
       * rather than assuming the strip exists.
       *
       * Only meaningful for a windowed display mode — a fullscreen or in-browser
       * app has no window controls to overlay, so we do not claim otherwise.
       */
      display_override:
        cfg.display === "standalone" || cfg.display === "minimal-ui"
          ? ["window-controls-overlay", cfg.display]
          : [cfg.display],
      orientation: cfg.orientation,
      /**
       * With WCO on, this paints ONLY the strip behind the minimise/maximise/
       * close buttons — the one part of the bar the page may not draw in. So it
       * has to be the title bar's own base colour, not the brand accent: set it
       * to the accent (as it was) and an installed window gets a loud coloured
       * band with the app's real bar butted against it, which is precisely the
       * bolted-on seam this is meant to remove.
       *
       * Resolved against the tenant's DEFAULT theme, because this value is read
       * before any of our code runs. Once the app boots it re-writes the meta
       * tag for the live theme (lib/pwa-config.ts, applyPwaDocument).
       */
      theme_color: titlebar.base,
      background_color: cfg.backgroundColor,
      icons: [
        { src: `/icons/app-icon-192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: `/icons/app-icon-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: `/icons/app-icon-maskable-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
    res.type("application/manifest+json");
    res.set("Cache-Control", "public, max-age=300");
    res.send(JSON.stringify(manifest));
  }),
);

router.get(
  "/icons/app-icon-maskable-:size(\\d+).png",
  hostTenantResolver,
  asyncHandler((req, res) => iconHandler(req, res, Number(req.params.size), true)),
);
router.get(
  "/icons/app-icon-:size(\\d+).png",
  hostTenantResolver,
  asyncHandler((req, res) => iconHandler(req, res, Number(req.params.size), false)),
);

module.exports = { router, resolvePwaConfig, renderIcon, clearIconCache, iconVersion };
