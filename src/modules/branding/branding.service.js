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

module.exports = { getBranding, setBranding, uploadLogo, getLogin, setLogin, uploadLoginBackground };
