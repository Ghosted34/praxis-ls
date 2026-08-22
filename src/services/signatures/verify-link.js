/**
 * The verification link a document carries — the resolved URL, the printed
 * code, and the QR that encodes them (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.7,
 * §5.2).
 *
 * ── Why this is a module and not two lines at the render site ──────────────
 * Three things have to agree or the QR is decoration: the host the code
 * resolves on, the `/v/` path (which is where the QR's density gain comes
 * from — §3.7 measured it), and the code's canonical spelling. Each render
 * path deriving its own would eventually produce a document whose printed
 * code and scanned URL point somewhere different, and nobody would find out
 * until a customer at a border post did.
 *
 * ── Resolving the host ─────────────────────────────────────────────────────
 * A tenant is reached at `<slug>.<APP_BASE_DOMAIN>` (middleware/host-tenent-
 * resolver.js), so the verify URL has to be on the tenant's OWN host: the
 * platform hosts do not resolve a tenant, and a QR pointing at one would 404
 * for everybody. In order:
 *
 *   1. `origin` from the caller. The HTTP path has `req.tenant.slug` and the
 *      worker path has `tenantMeta.slug`, so both real render paths can say
 *      exactly which host this document belongs to. This is the normal answer.
 *   2. The tenant setting `signature_policy.verify_base_url` — the override for
 *      a tenant serving the portal from its own domain.
 *   3. The apex. A last resort that will not resolve a tenant, and is here so a
 *      render never throws over a hostname; the code beneath the QR is still
 *      typable at the tenant's own /verify page, which is the failure mode
 *      worth having.
 *
 * Precedence puts the caller first deliberately: a tenant that moves host
 * should not have every document rendered that day pointing at a stale
 * setting.
 */
"use strict";

const { config } = require("../../config/env");
const { getSetting } = require("../../shared/config/settings");
const tokens = require("./tokens");
const qr = require("./qr");

/** Strip trailing slashes and anything after the authority. */
function normaliseBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** `https://smartls.praxisls.com` for a tenant slug. */
const originForSlug = (slug) =>
  (slug ? `https://${String(slug).toLowerCase().trim()}.${config.APP_BASE_DOMAIN}` : "");

/**
 * The base URL the QR resolves on. See the header for the precedence and why.
 * `client` may be null when the caller already knows the origin — the setting
 * lookup is skipped rather than failed.
 */
async function baseUrl(client, { origin = null, slug = null } = {}) {
  const fromCaller = normaliseBase(origin) || normaliseBase(originForSlug(slug));
  if (fromCaller) return fromCaller;
  if (client) {
    const configured = await getSetting(client, "signature_policy", "verify_base_url", null);
    const fromSetting = normaliseBase(configured);
    if (fromSetting) return fromSetting;
  }
  return `https://${config.APP_BASE_DOMAIN}`;
}

/**
 * Everything a renderer needs to print the verification block, for one
 * signature's code. Returns null for a missing code rather than a block
 * pointing at `/v/` with nothing after it — a QR that resolves to a 404 is
 * worse than no QR, because it reads as a broken product rather than an
 * unsigned document.
 */
async function verifyContext(client, { code, origin = null, slug = null, sizeMm = 22 } = {}) {
  const normalised = tokens.normaliseCode(code);
  if (!normalised) return null;
  const base = await baseUrl(client, { origin, slug });
  const url = tokens.verifyUrl(normalised, base);
  return { url, code: normalised, qrSvg: await qr.svg(url, { sizeMm }) };
}

module.exports = { baseUrl, verifyContext, originForSlug, normaliseBase };
