/**
 * White-label branding — reads/writes the tenant's `appearance` settings
 * (`setting` table, section='appearance', UNIQUE(section,key)). Kept as its own
 * tiny service (not generic setting CRUD) so the frontend can GET a clean
 * {name, primary, logoUrl} shape without juggling per-row setting_ids, and so
 * the GET can be exposed publicly (pre-login) while the write stays gated.
 */
"use strict";

const crypto = require("crypto");
const { audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const storage = require("../../services/storage.service");
const repo = require("./branding.repo");

const LOGO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};
const MAX_LOGO_BYTES = 512 * 1024;

// Full appearance token set (3.1). One tenant = one theme, so Pixie's
// Layer-A/Layer-B split collapses into this single map. Each entry maps the
// API field (camelCase) → the `setting` (section='appearance') key it persists
// under. Adding fields here is backward-compatible: the public GET stays a
// superset, so existing consumers reading name/primary/logoUrl keep working.
const KEYS = {
  // identity
  name: "display_name",
  // core colours
  primary: "primary_color",
  primaryForeground: "primary_foreground",
  secondary: "secondary_color",
  accent: "accent",
  accentDeep: "accent_deep",
  accentGlow: "accent_glow",
  // status colours
  info: "info",
  success: "success",
  warn: "warn",
  danger: "danger",
  // assets
  logoUrl: "logo_url",
  logoAltUrl: "logo_alt_url",
  faviconUrl: "favicon_url",
  // typography + shape
  fontDisplay: "font_display",
  fontBody: "font_body",
  fontMono: "font_mono",
  radius: "radius",
  // theme mode
  theme: "brand_theme",
};

async function getBranding(client) {
  const rows = await repo.getAppearance(client);
  const map = {};
  for (const r of rows) map[r.key] = r.value; // jsonb → already parsed (string/obj)

  const out = {};
  for (const [field, key] of Object.entries(KEYS)) {
    out[field] = map[key] ?? null;
  }
  return out;
}

async function setBranding(client, { actorId, ...fields }) {
  const changes = {};
  for (const field of Object.keys(KEYS)) {
    if (fields[field] !== undefined) changes[field] = fields[field]; // only touch provided fields
  }
  // Enforced contract: theme mode is a closed enum (the frontend switches the
  // whole token layer on it).
  if (changes.theme !== undefined && changes.theme !== null && !["dark", "light"].includes(changes.theme)) {
    throw new AppError("BAD_THEME", "brand_theme must be 'dark' or 'light'", 422);
  }
  for (const [field, val] of Object.entries(changes)) {
    // eslint-disable-next-line no-await-in-loop
    await repo.upsertAppearance(client, KEYS[field], val, actorId);
  }
  await audit(client, {
    actorUserId: actorId,
    action: "appearance.updated",
    moduleKey: "MOD-70",
    entityRef: "setting:appearance",
    after: changes,
  });
  return getBranding(client);
}

/**
 * Store an uploaded logo (a base64 data URL from the browser) through the file
 * storage service and return its public /media URL. Keys are namespaced per
 * tenant (`tenant_<slug>/branding/…`) so tenants can't collide on shared local
 * disk. Does NOT persist logo_url itself — the caller sets it via setBranding()
 * on Save, so upload + the rest of the appearance form commit together.
 */
async function uploadLogo({ dataUrl, slug }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_IMAGE", "Expected a base64 image data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = LOGO_EXT[contentType];
  if (!ext) throw new AppError("UNSUPPORTED_IMAGE", `Unsupported image type: ${contentType}`, 400);

  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new AppError("IMAGE_TOO_LARGE", "Logo must be 512 KB or smaller", 413);
  }

  const key = `tenant_${slug}/branding/logo_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const stored = await storage.put(buffer, { key, contentType });
  return { logoUrl: stored.public_url };
}

// ── Login screen editor (3.2) ──
const LOGIN_KEYS = {
  backgroundUrl: "background_url",
  headline: "headline",
  subtext: "subtext",
  layout: "layout",             // 'centered' | 'split'
  showLogo: "show_logo",         // boolean
  accentOverride: "accent_override",
};

async function getLogin(client) {
  const rows = await repo.getLogin(client);
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  const out = {};
  for (const [field, key] of Object.entries(LOGIN_KEYS)) out[field] = map[key] ?? null;
  return out;
}

async function setLogin(client, { actorId, ...fields }) {
  const changes = {};
  for (const field of Object.keys(LOGIN_KEYS)) {
    if (fields[field] !== undefined) changes[field] = fields[field];
  }
  if (changes.layout !== undefined && changes.layout !== null && !["centered", "split"].includes(changes.layout)) {
    throw new AppError("BAD_LAYOUT", "login.layout must be 'centered' or 'split'", 422);
  }
  for (const [field, val] of Object.entries(changes)) {
    // eslint-disable-next-line no-await-in-loop
    await repo.upsertLogin(client, LOGIN_KEYS[field], val, actorId);
  }
  await audit(client, { actorUserId: actorId, action: "login.updated", moduleKey: "MOD-70", entityRef: "setting:login", after: changes });
  return getLogin(client);
}

/** Store an uploaded login background (base64 data URL), namespaced per tenant.
 *  Does NOT persist background_url — the caller sets it via setLogin() on Save. */
async function uploadLoginBackground({ dataUrl, slug }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_IMAGE", "Expected a base64 image data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = LOGO_EXT[contentType];
  if (!ext) throw new AppError("UNSUPPORTED_IMAGE", `Unsupported image type: ${contentType}`, 400);
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new AppError("IMAGE_TOO_LARGE", "Background must be 512 KB or smaller", 413);
  }
  const key = `tenant_${slug}/login/bg_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const stored = await storage.put(buffer, { key, contentType });
  return { backgroundUrl: stored.public_url };
}

// ── Installed-app (PWA) design ──
//
// The tenant's *installed* identity: what the manifest advertises, what the
// home-screen icon looks like after the OS masks it, what the boot splash does,
// and the copy on the install / offline / update prompts. Same field→setting-key
// shape as KEYS above, same "only touch what was provided" write semantics.
//
// EVERY FIELD IS NULLABLE ON PURPOSE. null means "inherit", not "empty": an
// unset appName falls back to the brand name, an unset themeColor to the brand
// primary, an unset iconUrl to the brand logo. That is what lets a tenant
// configure Appearance once and get a coherent installed app for free, while
// still being able to override any single piece — a wide wordmark that works in
// the sidebar is usually the wrong home-screen icon, and this is where they
// part ways.
const PWA_KEYS = {
  // manifest identity
  appName: "app_name",
  shortName: "short_name",
  description: "description",
  display: "display",
  orientation: "orientation",
  themeColor: "theme_color",
  backgroundColor: "background_color",
  // icon source + transform (applied server-side by src/routes/pwa.js)
  iconUrl: "icon_url",
  iconBackground: "icon_background",
  iconPadding: "icon_padding",
  iconZoom: "icon_zoom",
  iconOffsetX: "icon_offset_x",
  iconOffsetY: "icon_offset_y",
  iconRadius: "icon_radius",
  maskableBackground: "maskable_background",
  maskablePadding: "maskable_padding",
  // boot splash
  splashEnabled: "splash_enabled",
  splashPreset: "splash_preset",
  splashDuration: "splash_duration",
  splashBackground: "splash_background",
  splashTagline: "splash_tagline",
  splashShowProgress: "splash_show_progress",
  // install prompt
  installEnabled: "install_enabled",
  installTitle: "install_title",
  installBody: "install_body",
  installIosBody: "install_ios_body",
  installButton: "install_button",
  // installed window title bar (window-controls-overlay)
  titlebarMode: "titlebar_mode",
  titlebarLight: "titlebar_light",
  titlebarDark: "titlebar_dark",
  titlebarImageUrl: "titlebar_image_url",
  titlebarImageOpacity: "titlebar_image_opacity",
  titlebarBlur: "titlebar_blur",
  // offline + update
  offlineText: "offline_text",
  offlineReadyText: "offline_ready_text",
  updateTitle: "update_title",
  updateBody: "update_body",
  updateButton: "update_button",
};

// The enums, ranges, caps, defaults and the fallback resolution itself live in
// @praxis/shared (pwa-design.js) because the CLIENT renders a preview of exactly
// what this module's values produce — see the note there.
const {
  PWA_ENUMS,
  PWA_RANGES,
  PWA_BOOLS,
  PWA_TEXT_MAX,
  PWA_TEXT_DEFAULT_MAX,
  PWA_DEFAULTS,
  effectivePwa,
  resolveTitlebar,
  clamp,
} = require("@praxis/shared").pwaDesign;

async function getPwa(client) {
  const rows = await repo.getPwa(client);
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  const out = {};
  for (const [field, key] of Object.entries(PWA_KEYS)) out[field] = map[key] ?? null;
  return out;
}

/**
 * Normalise one submitted PWA field. Returns the value to store, or throws for
 * the two things that are genuinely wrong rather than merely out of taste — an
 * unknown enum member (the frontend would have to switch on it) and a
 * non-numeric number.
 */
function normalisePwaField(field, val) {
  if (val === null || val === undefined || val === "") return null; // explicit "inherit"

  if (PWA_ENUMS[field]) {
    if (!PWA_ENUMS[field].includes(val)) {
      throw new AppError("BAD_PWA_VALUE", `${field} must be one of: ${PWA_ENUMS[field].join(", ")}`, 422);
    }
    return val;
  }
  if (PWA_RANGES[field]) {
    const n = Number(val);
    if (!Number.isFinite(n)) throw new AppError("BAD_PWA_VALUE", `${field} must be a number`, 422);
    return clamp(n, PWA_RANGES[field]);
  }
  if (PWA_BOOLS.includes(field)) return Boolean(val);

  // Free text (names, copy, colours, the icon URL). Trimmed and length-capped so
  // a paste accident can't put 4 KB into the manifest.
  const max = PWA_TEXT_MAX[field] ?? PWA_TEXT_DEFAULT_MAX;
  const s = String(val).trim().slice(0, max);
  return s || null;
}

async function setPwa(client, { actorId, ...fields }) {
  const changes = {};
  for (const field of Object.keys(PWA_KEYS)) {
    if (fields[field] !== undefined) changes[field] = normalisePwaField(field, fields[field]);
  }
  for (const [field, val] of Object.entries(changes)) {
    await repo.upsertPwa(client, PWA_KEYS[field], val, actorId);
  }
  await audit(client, {
    actorUserId: actorId,
    action: "pwa.updated",
    moduleKey: "MOD-70",
    entityRef: "setting:pwa",
    after: changes,
  });
  return getPwa(client);
}

/**
 * Store an uploaded app icon (base64 data URL). Written under the tenant's
 * existing PUBLIC `branding/` segment (media-guard.js) so it loads pre-auth like
 * the logo, and namespaced `tenant_<slug>/` so two tenants can never collide on
 * shared storage. Larger cap than the logo: the source wants to be ≥512px square
 * to survive being rendered at 512 for the splash.
 */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

async function uploadAppIcon({ dataUrl, slug }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_IMAGE", "Expected a base64 image data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = LOGO_EXT[contentType];
  if (!ext) throw new AppError("UNSUPPORTED_IMAGE", `Unsupported image type: ${contentType}`, 400);
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_ICON_BYTES) {
    throw new AppError("IMAGE_TOO_LARGE", "App icon must be 2 MB or smaller", 413);
  }
  const key = `tenant_${slug}/branding/appicon_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const stored = await storage.put(buffer, { key, contentType });
  return { iconUrl: stored.public_url };
}

module.exports = {
  getBranding,
  setBranding,
  uploadLogo,
  getLogin,
  setLogin,
  uploadLoginBackground,
  getPwa,
  setPwa,
  uploadAppIcon,
  effectivePwa,
  resolveTitlebar,
  PWA_KEYS,
  PWA_ENUMS,
  PWA_RANGES,
  PWA_DEFAULTS,
};
