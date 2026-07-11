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
const KEYS = { primary: "primary_color", primaryForeground: "primary_foreground", logoUrl: "logo_url", name: "display_name" };

async function getBranding(client) {
  const rows = await repo.getAppearance(client);
  const map = {};
  for (const r of rows) map[r.key] = r.value; // jsonb → already parsed (string/obj)

  return {
    name: map[KEYS.name] || null,
    primary: map[KEYS.primary] || null,
    primaryForeground: map[KEYS.primaryForeground] || null,
    logoUrl: map[KEYS.logoUrl] || null,
  };
}

async function setBranding(client, { primary, primaryForeground, logoUrl, name, actorId }) {
  const changes = { primary, primaryForeground, logoUrl, name };
  for (const [field, val] of Object.entries(changes)) {
    if (val === undefined) continue; // only touch provided fields
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

module.exports = { getBranding, setBranding, uploadLogo };
