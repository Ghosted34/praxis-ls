/**
 * BRAND LOGO RESOLUTION — one stored reference → something that renders
 * everywhere.
 *
 * A tenant's logo is persisted as a STORAGE KEY (`tenant_x/branding/logo_ab.png`)
 * or as a `/media/<key>` public URL. Neither of those loads in the two places
 * that matter most: a Puppeteer render has no page origin, so a relative URL
 * resolves to nothing, and an email client will not follow a relative path at
 * all. Inlining the bytes as a base64 data URI is what makes the same logo
 * appear in the on-screen preview, the generated PDF, the signature PNG and the
 * emailed HTML.
 *
 * WHY THIS IS A SERVICE AND NOT A PRIVATE HELPER. It was a private helper in
 * documents/template/template.service.js, which is where it was first needed.
 * The signature card needs exactly the same thing — and had a copy of the
 * problem instead: signature.resolve.js ran the raw reference through an
 * https-only check, so a stored key failed it, `show_logo` computed false, and
 * no signature the product has ever rendered carried a logo. A second copy of
 * this function would have been a second chance to get that wrong, so there is
 * one, here, and both callers use it.
 */
"use strict";

const storage = require("./storage.service");

const LOGO_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  gif: "image/gif",
};

/**
 * @param {string|null} ref  storage key, `/media/<key>`, absolute URL, or data URI
 * @returns {Promise<string|null>} a data URI, an absolute URL, or null
 */
async function resolveLogo(ref) {
  if (!ref) return null;
  if (/^data:/i.test(ref)) return ref;
  if (/^https?:/i.test(ref)) return ref; // remote/CDN URL — used as-is
  const key = String(ref).replace(/^\/media\//, "").replace(/^\/+/, "");
  try {
    const buf = await storage.get(key);
    if (buf && buf.length) {
      const ext = (key.split(".").pop() || "png").toLowerCase();
      return `data:${LOGO_MIME[ext] || "image/png"};base64,${buf.toString("base64")}`;
    }
  } catch { /* @silent:storage — a logo the storage backend cannot hand back must
    not stop a document rendering. Falling through to the raw ref gives the
    renderer a URL to try; a missing letterhead is a cosmetic loss, a failed
    invoice render is not. */ }
  return ref;
}

/**
 * Tenant-wide logo reference (Appearance → logo_url), used when a corporate
 * entity has no per-entity logo of its own. Most tenants set only the branding
 * logo, so without this the documents fall back to the brand NAME.
 */
async function brandingLogoRef(client) {
  try {
    const { rows } = await client.query(
      "SELECT value FROM setting WHERE section = 'appearance' AND key = 'logo_url' LIMIT 1",
    );
    const v = rows[0] && rows[0].value;
    return v ? (typeof v === "string" ? v : String(v)) : null;
  } catch { return null; }
}

/** The entity's own logo if it has one, else the tenant's, resolved to bytes. */
async function entityLogo(client, entity) {
  const ref = (entity && (entity.logo_url || entity.logo_light_ref)) || (await brandingLogoRef(client));
  return resolveLogo(ref);
}

module.exports = { resolveLogo, brandingLogoRef, entityLogo, LOGO_MIME };
