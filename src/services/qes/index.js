/**
 * QES provider resolution (doc/SIGNATURE_ENGINEERING_GUIDE.md §7.2, §7.5).
 *
 * One entry point for everything that needs a provider: the adapter, the
 * credentials and the platform pricing. The three call sites (the signing
 * handoff, the webhook, the poll worker) all come through here, which is
 * what makes "adding a provider is a new adapter file plus one settings row"
 * true rather than aspirational.
 *
 * ── WHERE THE CREDENTIALS LIVE, AND WHY THERE ARE TWO DOORS ────────────────
 * Two tiers, one lifecycle (INTEGRATION_PLAN.md §two):
 *
 *   1. TENANT — `integration_secret` section, key `qes_signwell`
 *      (AES-256-GCM, read via setting.service.readSecret, never returned
 *      over HTTP). The guide's §7.2 names this section explicitly, and it is
 *      the answer for a tenant that brings its own provider account.
 *
 *   2. PLATFORM — `qes.signwell` in the platform settings vault
 *      (Platform Console → Integrations). The free-tier allowance belongs to
 *      the Praxis account (§7.5: "one tenant must never see another's
 *      consumption"), so the default SignWell account is a deploy-wide
 *      integration in the deploy-wide vault, read via
 *      platformSettings.resolve — the same door storage and Geoapify use.
 *
 * Tenant first: a tenant that has bought its own quota should consume it
 * before the platform's, and a platform key that gets rotated must not
 * silently change which account a tenant's envelopes are billed to. Neither
 * value is ever in .env (§7.2, and BUILD_CONVENTIONS §7).
 *
 * ── CACHING ────────────────────────────────────────────────────────────────
 * Credentials are read on the signing path (a round trip per render would be
 * fine; a round trip per OTP verify would not). A 5-minute TTL matches the
 * event-type cache in shared/events/emit.js — long enough to make the common
 * case free, short enough that a rotated key is effective without a restart.
 *
 * The cache is keyed by a NAMED tenant: the slug the caller passes
 * explicitly, else the ambient request context on the request path. When
 * NEITHER names a tenant the entry is computed and NOT cached. A slot that
 * cannot identify its tenant must be a cache miss, never a shared one — the
 * version that fell back to a shared "_" key let the first tenant polled
 * populate a slot that every other tenant in the same 5-minute window then
 * read, because workers have no request context at all and the poll
 * scheduler fans the fleet out together. One tenant's key answering another
 * tenant's question is the mistake PERF S9 was about, wearing a worker's
 * clothes.
 */
"use strict";

const { logger } = require("../../config/logger");
const requestContext = require("../../config/request-context");
const { AppError } = require("../../utils/errors");

const signwell = require("./signwell.adapter");
const { assertAdapter } = require("./provider.interface");

// key → adapter. This is the registry §7.2's "adding a provider is a new
// file here plus one settings row" points at.
const ADAPTERS = new Map([
  ["signwell", assertAdapter(signwell)],
]);

const TTL_MS = 5 * 60 * 1000;
const credentialCache = new Map(); // "<tenant>:<provider>" -> { at, cfg }

/**
 * The tenant the cache key will name, or null.
 *
 * Explicit beats ambient: a worker that knows its tenant says so, and an
 * ambient context that exists is the request path's convenience. Null means
 * "this call cannot identify its tenant", which the caller of providerConfig
 * reads as "compute, but do not cache".
 */
function tenantOf(explicit) {
  if (explicit) return String(explicit);
  const ctx = requestContext.get();
  return (ctx && ctx.tenant) || null;
}

/** Drop the credential cache. Exposed for tests and for the settings write path. */
function invalidate() {
  credentialCache.clear();
}

/**
 * The adapter for a provider key, or a 422 that names what is supported.
 * DocuSign is adapter #2 in the plan (Q14) and a file away from this Map;
 * until it ships, the answer is "unsupported", not a half-wired branch.
 */
function resolveAdapter(providerKey = "signwell") {
  const adapter = ADAPTERS.get(String(providerKey || "").toLowerCase());
  if (!adapter) {
    throw new AppError(
      "QES_PROVIDER_UNSUPPORTED",
      `No certified-signature provider is available under the name '${providerKey}'.`,
      422,
      { supported: [...ADAPTERS.keys()] },
    );
  }
  return adapter;
}

/**
 * Resolve the provider's credentials for a tenant.
 *
 * Returns `{ apiKey, source }` — `source` is "tenant" or "platform" and is
 * what the settings panel and the audit rows say about WHICH account the
 * envelope will consume. Returns null (not a throw) when neither door has a
 * key: the caller decides whether that is a 409 (the signing handoff, where
 * the counterparty needs a straight answer) or a disabled card (the menu,
 * where the flag is the more visible control).
 */
async function providerConfig(client, providerKey = "signwell", { tenant = null } = {}) {
  resolveAdapter(providerKey); // fail on an unknown provider BEFORE the cache

  const t = tenantOf(tenant);
  const key = t ? `${t}:${providerKey}` : null;
  if (key) {
    const hit = credentialCache.get(key);
    if (hit && hit.at + TTL_MS > Date.now()) return hit.cfg;
  }

  let cfg = null;

  // Door 1 — the tenant's own key.
  try {
    const tenantKey = await require("../../modules/security/setting/setting.service")
      .readSecret(client, "qes_signwell");
    if (tenantKey) cfg = { apiKey: tenantKey, source: "tenant" };
  } catch (err) {
    // The setting table is in the same schema as everything else; a failure
    // here is a database failure, and a database failure must not masquerade
    // as "not configured" — that would make a wedged tenant look like it has
    // no provider when the answer is "the database is down".
    logger.error({ err: err && err.message, provider: providerKey }, "tenant QES credential read failed");
    throw err;
  }

  // Door 2 — the platform account (the free tier §7.5 talks about).
  if (!cfg) {
    try {
      const row = await require("../../services/platform/settings.service").resolve("qes", "signwell");
      if (row && row.secret) cfg = { apiKey: row.secret, source: "platform" };
    } catch (err) {
      logger.warn({ err: err && err.message, provider: providerKey }, "platform QES credential read failed");
      // The platform DB being unreachable does NOT make the tenant
      // unconfigured — it means the platform account could not be checked.
      // A tenant with its own key above is already served; without one, the
      // honest answer is a loud failure, not a silent "not configured".
      throw err;
    }
  }

  // Cached only when the key names a tenant — see tenantOf for why an
  // unidentifiable slot must stay a miss.
  if (cfg && key) credentialCache.set(key, { at: Date.now(), cfg });
  return cfg;
}

/**
 * The platform pricing: what Praxis bills a tenant per envelope, the
 * currency, and the monthly envelope allowance the quota scheduler watches.
 *
 * All platform-tier on purpose (§7.5): a tenant cannot set the price Praxis
 * charges it, and no tenant needs to see the figure at all. The values live
 * in the platform settings vault as `qes.pricing`, edited in Platform
 * Console → Integrations → Certified signing.
 *
 * `unit_cost` defaults to 0, and that is a VALUE, not a miss: an envelope
 * issued before the operator sets a rate is metered at what the rate WAS
 * (zero, on the free tier), and a later rate change must not rewrite history
 * — the ledger row is the meter reading at the moment of issue.
 */
async function platformPricing() {
  let value = {};
  try {
    const row = await require("../../services/platform/settings.service").resolve("qes", "pricing");
    value = (row && row.value) || {};
  } catch (err) {
    // Pricing is read on the charging path. A platform-DB hiccup must not
    // block a signature from being sent — the envelope goes out, the ledger
    // row records the default, and the quota scheduler (which needs the same
    // values) reports the platform database's state where it belongs.
    logger.warn({ err: err && err.message }, "platform QES pricing read failed — using defaults");
  }
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    unitCost: num(value.unit_cost, 0),
    currency: String(value.currency || "XAF").toUpperCase(),
    monthlyQuota: num(value.monthly_quota, 25),
  };
}

/**
 * Whether a provider is usable for a tenant at all: credentials present.
 * The feature flag is a separate question (the menu answers it); this is
 * the "is there an account behind the switch" question.
 */
async function isConfigured(client, providerKey = "signwell", opts = {}) {
  return Boolean(await providerConfig(client, providerKey, opts));
}

module.exports = {
  signwell,
  ADAPTERS,
  resolveAdapter,
  providerConfig,
  platformPricing,
  isConfigured,
  invalidate,
};
