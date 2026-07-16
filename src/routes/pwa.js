/**
 * Per-tenant PWA surface (Phase 0). Subdomain-per-tenant means every workspace
 * is its own origin, so the web-app manifest and its icons can be resolved from
 * the Host and built live from the tenant's branding:
 *   GET /manifest.webmanifest        name / short_name / theme_color=primary
 *   GET /icons/app-icon-<size>.png   tenant logo (sharp-fit) or a brand monogram
 *   GET /icons/app-icon-maskable-512.png  maskable variant (safe-zone padded)
 *
 * All three are PUBLIC and Host-resolved (like GET /branding). They never throw:
 * unknown/platform hosts and any branding/logo failure fall back to generic
 * Praxis defaults so "Add to home screen" always works. Icons are cached both
 * in-process (rendered PNG) and via Cache-Control. The client links to
 * /manifest.webmanifest directly (vite-plugin-pwa runs with manifest:false).
 */
"use strict";

const express = require("express");
const sharp = require("sharp");
const { hostTenantResolver } = require("../middleware/host-tenent-resolver");
const { asyncHandler } = require("../utils/errors");
const registry = require("../services/tenant/registry.service");
const storage = require("../services/storage.service");
const brandingService = require("../modules/branding/branding.service");

const DEFAULTS = { name: "Praxis LS", short: "Praxis", primary: "#F5821F", bg: "#ffffff" };

// Small bounded in-process cache for rendered icons (keyed by tenant+variant+logo).
const ICON_CACHE = new Map();
const ICON_CACHE_MAX = 64;
function iconCacheGet(key) {
  return ICON_CACHE.get(key) || null;
}
function iconCacheSet(key, buf) {
  if (ICON_CACHE.size >= ICON_CACHE_MAX) ICON_CACHE.delete(ICON_CACHE.keys().next().value);
  ICON_CACHE.set(key, buf);
}

/** Resolve the tenant's branding for the manifest/icons, never throwing. */
async function resolveBranding(req) {
  if (!req.tenant) return { ...DEFAULTS, slug: "platform", logoUrl: null };
  const slug = req.tenant.slug || DEFAULTS.name;
  try {
    const b = await registry.withTenantConnection(req.tenant, "live", (c) => brandingService.getBranding(c));
    const name = b.name || slug;
    return {
      slug,
      name,
      short: String(name).slice(0, 12),
      primary: b.primary || DEFAULTS.primary,
      bg: DEFAULTS.bg,
      logoUrl: b.logoUrl || null,
    };
  } catch {
    return { ...DEFAULTS, slug, name: slug, short: String(slug).slice(0, 12), logoUrl: null };
  }
}

/** Load the tenant logo bytes from storage, or null (any failure → monogram). */
async function loadLogo(logoUrl) {
  if (!logoUrl || typeof logoUrl !== "string") return null;
  const key = logoUrl.replace(/^https?:\/\/[^/]+/, "").replace(/^\/media\//, "").replace(/^\//, "");
  if (!key) return null;
  try {
    return await storage.get(key);
  } catch {
    return null;
  }
}

function monogramLetter(branding) {
  const src = String(branding.short || branding.name || "P").trim();
  const ch = src.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(ch) ? ch : "P";
}

/** Render a size×size PNG app icon from the logo, or a brand-coloured monogram. */
async function renderIcon({ size, maskable, branding, logoBuf }) {
  const px = Math.min(1024, Math.max(48, Number(size) || 192));
  const bg = branding.primary || DEFAULTS.primary;

  if (logoBuf) {
    // Maskable icons need a ~20% safe zone; plain icons get a light inset.
    const pad = Math.round(px * (maskable ? 0.2 : 0.08));
    const inner = Math.max(1, px - pad * 2);
    const resized = await sharp(logoBuf)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return sharp({ create: { width: px, height: px, channels: 4, background: maskable ? bg : "#ffffff" } })
      .composite([{ input: resized, gravity: "center" }])
      .png()
      .toBuffer();
  }

  const radius = maskable ? 0 : Math.round(px * 0.22);
  const letter = monogramLetter(branding);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
      `<rect width="${px}" height="${px}" rx="${radius}" ry="${radius}" fill="${bg}"/>` +
      `<text x="50%" y="50%" font-family="Montserrat, Arial, sans-serif" font-size="${Math.round(px * 0.5)}" ` +
      `font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${letter}</text>` +
      `</svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function iconHandler(req, res, size, maskable) {
  const branding = await resolveBranding(req);
  const cacheKey = `${branding.slug}:${size}:${maskable ? "m" : "a"}:${branding.logoUrl || ""}:${branding.primary}`;
  let png = iconCacheGet(cacheKey);
  if (!png) {
    const logoBuf = await loadLogo(branding.logoUrl);
    png = await renderIcon({ size, maskable, branding, logoBuf });
    iconCacheSet(cacheKey, png);
  }
  res.type("image/png");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(png);
}

const router = express.Router();

router.get(
  "/manifest.webmanifest",
  hostTenantResolver,
  asyncHandler(async (req, res) => {
    const b = await resolveBranding(req);
    const manifest = {
      id: "/",
      name: b.name,
      short_name: b.short,
      description: `${b.name} — logistics & accounting platform`,
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      theme_color: b.primary,
      background_color: b.bg,
      icons: [
        { src: "/icons/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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

module.exports = { router, resolveBranding, renderIcon };
