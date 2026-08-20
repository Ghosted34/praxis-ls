/**
 * WorkbookContext — everything a branded spreadsheet needs about the tenant,
 * resolved ONCE per request/job inside the tenant connection (`req.tenantDb`
 * or the job's `withTenantConnection`). The builder itself stays pure: no
 * client, no query — which is what lets unit tests feed it a fixture context.
 *
 * WHERE EACH FACT COMES FROM (and nowhere else):
 *   brand     branding.service (the `appearance` section of `setting`)
 *   entity    corporate_entity.repo — legal identity, default_language,
 *             timezone, default_currency
 *   currency  master/currency (MOD-08) — the ONE currency source of truth:
 *             repo.getBaseCode for the base, service.listCurrencies for the
 *             active catalogue. No second SQL, no JS rate table, no XAF
 *             assumption: the base is whatever the tenant flagged, and a
 *             tenant that switches to USD tomorrow is correctly rendered.
 *   world facts (canonical symbol/name, ISO minor units) come from
 *   @praxis/shared's currencies catalogue — the same file the currency 360
 *   composes with — ONLY as a fallback when the tenant row lacks the fact:
 *     decimals = tenantRow.decimals ?? shared.decimalsFor(code) ?? 2
 */
"use strict";

const branding = require("../../modules/branding/branding.service");
const entityRepo = require("../../modules/master/corporate_entity/corporate_entity.repo");
const currencyService = require("../../modules/master/currency/currency.service");
const currencyRepo = require("../../modules/master/currency/currency.repo");
const storage = require("../storage.service");
const { currencies } = require("@praxis/shared");
const { safeTimezone } = require("./helpers");

/** The neutral, unbranded Praxis default — what a fixture/no-context build
 *  renders. NOT any other product's palette: the app's own unconfigured
 *  primary (client/src/index.css --primary / kit.defaults accent). */
const NEUTRAL = Object.freeze({
  primary: "#F5821F",
  primaryForeground: "#FFFFFF",
  accent: "#F5821F",
});

/** The context equivalent of "no branding configured / unit test". */
function neutralContext(overrides = {}) {
  const now = new Date();
  return {
    tenant: { name: null, ...NEUTRAL, logoUrl: null, logo: null, fontDisplay: null, fontBody: null },
    entity: {},
    currencies: {},
    baseCurrency: null,
    language: "en",
    timezone: "UTC",
    env: "live",
    actor: null,
    title: null,
    filters: null,
    generatedAt: now,
    ...overrides,
  };
}

/**
 * Resolve the tenant's logo to embeddable bytes, best-effort — an unreadable
 * logo must never fail an export.
 *
 * data: URIs decode directly; /media/<key> refs (what uploadLogo persists)
 * read through the storage service. Remote http(s) URLs are SKIPPED: fetching
 * one here would hold the pinned tenant connection across an outbound HTTP
 * call, the exact pattern this repo forbids (see the attendance guide's
 * Geoapify rule). SVG is skipped too — ExcelJS cannot embed it. Dimensions
 * come from sharp so the cover can scale without distorting the mark.
 */
const IMAGE_TYPES = { png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif", bmp: "bmp" };
const COVER_LOGO_HEIGHT = 56;

async function resolveLogo(ref) {
  if (!ref || typeof ref !== "string") return null;
  let buffer = null;
  let ext = "";
  const dataUri = /^data:([^;]+);base64,(.+)$/s.exec(ref);
  if (dataUri) {
    const mime = dataUri[1].toLowerCase().replace("image/", "");
    ext = IMAGE_TYPES[mime];
    if (ext) buffer = Buffer.from(dataUri[2], "base64");
  } else if (ref.startsWith("/media/")) {
    const key = ref.replace(/^\/media\//, "").replace(/^\/+/, "");
    ext = IMAGE_TYPES[(key.split(".").pop() || "").toLowerCase()];
    if (ext) {
      try {
        buffer = await storage.get(key);
      } catch {
        /* @silent:storage — a missing logo file degrades the cover to the
           tenant name, which is the designed fallback, not a failure. */
        return null;
      }
    }
  }
  if (!buffer || !buffer.length) return null;
  try {
    const sharp = require("sharp");
    const meta = await sharp(buffer).metadata();
    const w = Number(meta.width) || 0;
    const h = Number(meta.height) || 0;
    if (!w || !h) return null;
    const height = COVER_LOGO_HEIGHT;
    const width = Math.min(Math.round((w * height) / h), 360);
    return { base64: buffer.toString("base64"), extension: ext, width, height };
  } catch {
    /* @silent:storage — undecodable image bytes: same fallback as a missing
       logo. sharp is a runtime dep, so this catch is about bad bytes. */
    return null;
  }
}

/**
 * resolveContext(client, opts) → WorkbookContext. Read-only; runs inside the
 * caller's tenant connection so branding, currency and env all observe the
 * SAME environment (live vs sandbox) as the data being exported.
 *
 * opts: { entityId, actor, title, filters, generatedAt }
 *   entityId — which corporate entity's identity/language/timezone to use
 *              (multi-entity tenants); default: the first entity.
 *   actor    — req.user or job actor → { user_id, name } for the cover.
 */
async function resolveContext(client, opts = {}) {
  // Branding first: an unconfigured tenant simply yields all-null tokens,
  // which the neutral default fills in — no error path for "no theme yet".
  const brand = await branding.getBranding(client);
  const entity = opts.entityId
    ? await entityRepo.get(client, opts.entityId)
    : await entityRepo.first(client);

  const [currencyRows, baseCode] = await Promise.all([
    currencyService.listCurrencies(client),
    currencyRepo.getBaseCode(client),
  ]);

  const catalogue = {};
  for (const row of currencyRows) {
    const code = String(row.code || "").trim().toUpperCase();
    if (!code) continue;
    const world = currencies.byCode(code);
    // Tenant row wins (it is what the tenant chose to store); the ISO
    // catalogue answers only what the row leaves unset; 2 is the last resort.
    const decimals = Number.isInteger(row.decimals)
      ? row.decimals
      : world
        ? world.decimals
        : 2;
    catalogue[code] = {
      code,
      symbol: row.symbol || (world && world.symbol) || code,
      name: row.name || (world && world.name) || code,
      decimals,
      is_base: row.is_base === true || code === baseCode,
    };
  }

  const timezone = safeTimezone((entity && entity.timezone) || "Africa/Douala");
  return {
    tenant: {
      name: brand.name || null,
      primary: brand.primary || NEUTRAL.primary,
      primaryForeground: brand.primaryForeground || NEUTRAL.primaryForeground,
      accent: brand.accent || brand.primary || NEUTRAL.accent,
      logoUrl: brand.logoUrl || null,
      // Embedded bytes + display size, resolved here (I/O) so the pure builder
      // only places what it is handed. Null when unresolvable.
      logo: await resolveLogo(brand.logoUrl),
      fontDisplay: brand.fontDisplay || null,
      fontBody: brand.fontBody || null,
    },
    entity: entity
      ? {
          legal_name: entity.legal_name || null,
          rccm: entity.rccm || null,
          niu: entity.niu || null,
          address: entity.address || null,
          default_currency: entity.default_currency || null,
          default_language: entity.default_language || null,
          timezone: entity.timezone || null,
        }
      : {},
    currencies: catalogue,
    // Whatever the tenant flagged — never an assumed XAF (a tenant can switch
    // base to USD tomorrow; the column headers and formats must follow).
    baseCurrency: baseCode || null,
    language: (entity && entity.default_language) === "fr" ? "fr" : "en",
    timezone,
    // Same signal kit.watermarkFor reads: the registry tags every pooled
    // client with the environment it is pinned to.
    env: client && client[Symbol.for("praxis.conn.env")] === "sandbox" ? "sandbox" : "live",
    actor: opts.actor
      ? {
          user_id: opts.actor.user_id ?? null,
          name: opts.actor.full_name || opts.actor.name || opts.actor.username || null,
        }
      : null,
    title: opts.title || null,
    filters: opts.filters || null,
    generatedAt: opts.generatedAt || new Date(),
  };
}

module.exports = { resolveContext, neutralContext, NEUTRAL };
