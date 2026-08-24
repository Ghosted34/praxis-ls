/**
 * AI Governance service (AI control surface, AI_ARCHITECTURE §6). The per-tenant
 * EMV toggle, user access grants, spend caps and vendor credentials that gate the
 * whole AI subsystem:
 *   canUseFeature(user, key)  runtime guard the orchestrator calls before any AI work
 *   recordUsage(...)          append the per-call cost ledger row (budget accounting)
 *   getVendorConfig(vendor)   decrypted creds for the AI layer (INTERNAL only)
 * Vendor API keys are AES-256-GCM encrypted at rest (encryption.service); read
 * APIs never return the ciphertext. All SQL is in the repo; rules are pure.
 */
"use strict";

const repo = require("./governance.repo");
const events = require("./governance.events");
const { estimateCostNative, capState, canUse } = require("./governance.rules");
const encryption = require("../../../services/encryption.service");
const currencyService = require("../../master/currency/currency.service");
const currencyRepo = require("../../master/currency/currency.repo");
const { logger } = require("../../../config/logger");
const registry = require("../../../services/tenant/registry.service");
const entitlement = require("../../../services/platform/entitlement.service");
const axios = require("axios");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const today = () => new Date().toISOString().slice(0, 10);

// ── Feature flags ──
const listFeatures = (client) => repo.listFlags(client);

async function setFeature(client, { featureKey, patch = {}, actor = {} }) {
  const before = await repo.getFlag(client, featureKey);
  if (!before) throw new AppError("NOT_FOUND", "Feature flag " + featureKey + " not found", 404);
  const fields = {};
  for (const k of ["is_enabled", "default_provider", "default_model", "est_cost_per_call_xaf", "description"]) if (patch[k] !== undefined) fields[k] = patch[k];
  fields.last_changed_by = actor.user_id || null;
  fields.last_changed_at = new Date().toISOString();
  const row = await repo.setFlag(client, featureKey, fields);
  await emitEvent(client, { eventTypeKey: events.FEATURE_CHANGED, moduleKey: events.MODULE, entityRef: "ai_feature:" + featureKey, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.FEATURE_CHANGED, moduleKey: events.MODULE, entityRef: "ai_feature:" + featureKey, before, after: row });
  return row;
}

// ── Access grants ──
async function grantAccess(client, { userId, featureKey, monthlyCapXaf = null, actor = {} }) {
  const existing = await repo.grantFor(client, userId, featureKey);
  if (existing && !existing.revoked_at) throw new AppError("ALREADY_GRANTED", "User already has this grant", 409);
  const row = await repo.insertGrant(client, { user_id: userId, feature_key: featureKey, monthly_cap_xaf: monthlyCapXaf, granted_by: await resolveActorId(client, actor.user_id) });
  await emitEvent(client, { eventTypeKey: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef: "ai_grant:" + row.grant_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef: "ai_grant:" + row.grant_id, after: row });
  return row;
}

async function revokeAccess(client, { userId, featureKey, reason = null, actor = {} }) {
  const row = await repo.revokeGrant(client, userId, featureKey, reason, actor.user_id || null);
  if (!row) throw new AppError("NOT_FOUND", "No active grant to revoke", 404);
  await emitEvent(client, { eventTypeKey: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef: "ai_grant:" + row.grant_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef: "ai_grant:" + row.grant_id, after: row });
  return row;
}

const listGrants = (client, q) => repo.listGrants(client, q);

// ── Budget + the runtime guard ──
async function budgetStatus(client, { onDate = null } = {}) {
  const date = onDate || today();
  const period = await repo.activeBudget(client, date);
  if (!period) return { period: null, spent_xaf: 0, state: "OK" };
  const spent = await repo.spentInPeriod(client, period.period_id);
  return { period, spent_xaf: spent, state: capState(spent, period) };
}

async function setBudget(client, { periodStart, periodEnd, softCapXaf = null, hardCapXaf = null, actor = {} }) {
  if (Date.parse(periodEnd) < Date.parse(periodStart)) throw new AppError("BAD_WINDOW", "period_end must be >= period_start", 422);
  const row = await repo.insertBudget(client, { period_start: periodStart, period_end: periodEnd, soft_cap_xaf: softCapXaf, hard_cap_xaf: hardCapXaf, set_by: await resolveActorId(client, actor.user_id) });
  await emitEvent(client, { eventTypeKey: events.BUDGET_SET, moduleKey: events.MODULE, entityRef: "ai_budget:" + row.period_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.BUDGET_SET, moduleKey: events.MODULE, entityRef: "ai_budget:" + row.period_id, after: row });
  return row;
}

// The tenant-level feature key the platform console projects into `feature_state`
// (what the login/UI gate resolves). The orchestrator's per-call gate resolves the
// SAME switch, so if the UI shows AI the runtime agrees — previously this gate read
// a never-seeded `ai_feature_flag['assistant']` row, so a console toggle never
// reached the orchestrator and every ask blocked with "feature disabled".
const TENANT_FEATURE_KEY = "ai.assistant.backend";

/** The gate every AI entry point calls: is this user allowed to use this feature now?
 *  Tenant enablement = the console's `feature_state` ceiling + the tenant's
 *  `ai_feature_flag` preference (default ON when entitled), via `isFeatureEnabled`.
 *  A per-user access grant only RESTRICTS: an explicit, un-revoked grant is honoured,
 *  but a MISSING grant means "not specifically restricted" → allowed for an entitled
 *  tenant (the copilot is already bounded by the user's RBAC). An explicit revoked
 *  grant blocks that user; the budget hard-cap always blocks. */
async function canUseFeature(client, { userId, featureKey, onDate = null }) {
  const enabled = await isFeatureEnabled(client, TENANT_FEATURE_KEY);
  const explicit = userId ? await repo.grantFor(client, userId, featureKey) : null;
  const grant = explicit || { revoked_at: null };
  const budget = await budgetStatus(client, { onDate });
  const verdict = canUse({ flag: { is_enabled: enabled }, grant, budgetState: budget.state });

  // ── WS-S3: the PLAN's AI spend limit ──────────────────────────────────────
  //
  // `budgetStatus` above is the tenant's OWN cap — what they chose to spend, set
  // by them, in their own database. This is a different question: what their
  // PLAN entitles them to, set by Praxis, in the platform database. A tenant
  // can sit comfortably inside a self-imposed budget they raised last week and
  // still be past what they are paying for. Only the first of those was ever
  // enforced, which made the plan limit a number on a dashboard.
  //
  // Checked here rather than at each call site because this is the gate every
  // AI entry point already goes through — the orchestrator, the vision handler,
  // the transcription handler — and adding a second gate they each had to
  // remember would reintroduce exactly the "enforcement hole by omission"
  // problem this work is closing.
  //
  // `additional: 0` — the cost of the call about to be made is not knowable
  // before it is made, so this asks "are they already past the limit" rather
  // than pretending to price the next request. The overshoot is one call, and
  // it is recorded.
  if (verdict.allowed) {
    const tenantId = registry.tenantIdOf(client);
    try {
      await entitlement.guard(tenantId, "ai_spend_xaf", { action: `ai.${featureKey}` });
    } catch (err) {
      // Both cases are a refusal, and the REASON is surfaced verbatim by the
      // orchestrator ("The AI assistant is unavailable: <reason>"), so the two
      // must read differently to a user: one is "buy more", the other is "not
      // your fault, try again".
      if (err && err.code === "ENTITLEMENT_EXCEEDED") {
        return {
          allowed: false,
          reason: "the plan's AI spend limit for this month has been reached",
          feature_key: featureKey,
          budget_state: budget.state,
          spent_xaf: budget.spent_xaf,
          plan_limited: true,
        };
      }
      if (err && err.code === "ENTITLEMENT_CHECK_UNAVAILABLE") {
        // Fails closed, consistent with every other guard: an unverifiable
        // spend limit must not become an unmetered one. Already paged by
        // `guard`, so this only shapes the message.
        return {
          allowed: false,
          reason: "plan limits cannot be verified right now — this is a platform fault, please retry shortly",
          feature_key: featureKey,
          budget_state: budget.state,
          spent_xaf: budget.spent_xaf,
          plan_limited: true,
        };
      }
      throw err;
    }
  }

  return { ...verdict, feature_key: featureKey, budget_state: budget.state, spent_xaf: budget.spent_xaf };
}

/** Lightweight tenant-level switch: is a feature turned on for this tenant?
 *  Ignores the per-user grant + budget (those are enforced at call time in the
 *  orchestrator). Used by auth to tell the UI whether to show any AI/comms at all.
 *
 *  Two-level model ("console gates, tenant refines"):
 *   - Level 1 (ceiling): the platform console's projected `feature_state`. OFF
 *     here = hard off; the tenant cannot self-enable. This is what makes a
 *     console toggle actually reach the tenant screen.
 *   - Level 2 (preference): the tenant's own `ai_feature_flag.is_enabled`, which
 *     only matters once entitled. Default ON when entitled and the tenant has
 *     set no explicit preference (no flag row), so entitling a feature shows it
 *     immediately without a second tenant-side flip.
 *  Effective = entitled AND tenant-enabled. */
async function isFeatureEnabled(client, featureKey) {
  const entitled = await repo.featureStateOn(client, featureKey);
  if (!entitled) return false;
  const flag = await repo.getFlag(client, featureKey);
  return flag ? Boolean(flag.is_enabled) : true;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * One vendor-currency amount → the tenant's base currency, via MOD-08.
 *
 * Direction matters and the feed only writes one of the two. `fx-sync` stores
 * base→quote rows (XAF→USD = 0.0016…), while a treasurer's manual override may
 * be entered either way round — so the direct pair (USD→XAF) is tried first and
 * the reverse is inverted when only it exists. No rate on file for the pair
 * leaves the base amount at 0 rather than passing the native figure through
 * unconverted: a USD number sitting in an XAF column would understate spend
 * ~600× and quietly corrupt every budget cap that reads it. `cost_native` still
 * carries the true figure, and the Usage screen falls back to showing it.
 */
async function nativeToBase(client, { amount, code, date }) {
  const value = Number(amount || 0);
  if (!value) return 0;
  const base = await currencyRepo.getBaseCode(client);
  const from = String(code || "").trim().toUpperCase();
  if (!base || !from || from === base) return round2(value);
  const at = async (b, q) => {
    try {
      const row = await currencyService.rateFor(client, { base: b, quote: q, date });
      const rate = Number(row && row.rate);
      return Number.isFinite(rate) && rate > 0 ? rate : null;
    } catch {
      /* @silent:storage — an unpriced pair is an expected tenant state (FX
         feed not configured yet), not a failure of the AI call being metered. */
      return null;
    }
  };
  const direct = await at(from, base);
  if (direct) return round2(value * direct);
  const reverse = await at(base, from);
  if (reverse) return round2(value / reverse);
  logger.warn({ from, base }, "ai usage: no FX rate — cost recorded in native currency only");
  return 0;
}

/** Append a usage row against the active budget period (cost accounting). */
async function recordUsage(client, { userId = null, featureKey = null, conversationId = null, provider = null, model = null, callType = null, inputTokens = 0, outputTokens = 0, audioSeconds = 0, costXaf = null, costNative = 0, costNativeCurrency = null, latencyMs = null, wasSuccessful = true, errorCode = null, errorMessage = null, onDate = null }) {
  const date = onDate || today();
  const period = await repo.activeBudget(client, date);
  const vendor = provider ? await repo.getVendorSafe(client, provider) : null;
  // Price the call in the vendor's own currency first (see governance.rules),
  // unless the caller already priced it.
  let native = Number(costNative || 0);
  let nativeCurrency = costNativeCurrency;
  if (!native && vendor) {
    native = estimateCostNative({ inputTokens, outputTokens, audioSeconds, vendor });
    nativeCurrency = nativeCurrency || vendor.cost_native_currency || null;
  }
  const cost =
    costXaf === null || costXaf === undefined
      ? await nativeToBase(client, { amount: native, code: nativeCurrency, date })
      : costXaf;
  const row = await repo.insertUsage(client, {
    user_id: userId, feature_key: featureKey, conversation_id: conversationId, period_id: period ? period.period_id : null,
    provider, model: model || (vendor && (vendor.current_model || vendor.default_model)) || null,
    call_type: callType, audio_seconds: audioSeconds, input_tokens: inputTokens, output_tokens: outputTokens,
    total_tokens: Number(inputTokens) + Number(outputTokens), cost_native: native, cost_native_currency: nativeCurrency,
    cost_xaf: cost, latency_ms: latencyMs, was_successful: wasSuccessful, error_code: errorCode, error_message: errorMessage,
  });
  return row;
}

const listUsage = (client, q) => repo.listUsage(client, q);

// ── Vendor credentials (keys encrypted) ──
const listVendors = (client) => repo.listVendors(client);
const getVendor = (client, vendor) => repo.getVendorSafe(client, vendor);

async function setVendor(client, { vendor, apiKey = null, patch = {}, actor = {} }) {
  const fields = {};
  for (const k of ["display_name", "endpoint_url", "default_model", "current_model", "cost_per_1k_input_tokens", "cost_per_1k_output_tokens", "cost_per_audio_minute", "cost_native_currency", "per_vendor_monthly_cap_xaf", "is_active"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (apiKey) { fields.api_key_enc = encryption.encrypt(apiKey); fields.last_rotated_at = new Date().toISOString(); fields.last_rotated_by = actor.user_id || null; }
  const row = await repo.upsertVendor(client, vendor, fields);
  const key = apiKey ? events.VENDOR_ROTATED : events.VENDOR_SET;
  await emitEvent(client, { eventTypeKey: key, moduleKey: events.MODULE, entityRef: "ai_vendor:" + vendor, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: key, moduleKey: events.MODULE, entityRef: "ai_vendor:" + vendor, after: { vendor, rotated: Boolean(apiKey) } });
  return row;
}

/** INTERNAL — decrypted vendor config for the AI runtime. Never exposed via HTTP. */
async function getVendorConfig(client, vendor) {
  const full = await repo.getVendorFull(client, vendor);
  if (!full) return null;
  return { vendor: full.vendor, endpoint_url: full.endpoint_url, model: full.current_model || full.default_model, api_key: full.api_key_enc ? encryption.decrypt(full.api_key_enc) : null, is_active: full.is_active };
}

/** Test a stored vendor key with a minimal live auth call (GET /models). No writes. */
async function testVendor(client, vendor) {
  const cfg = await getVendorConfig(client, vendor);
  if (!cfg || !cfg.api_key) return { ok: false, error: "no API key configured for " + vendor };
  if (!cfg.endpoint_url) return { ok: false, error: "no endpoint_url configured for " + vendor };
  try {
    const base = String(cfg.endpoint_url).replace(/\/$/, "");
    const res = await axios.get(base + "/models", { headers: { Authorization: "Bearer " + cfg.api_key }, timeout: 15000 });
    const count = res.data && Array.isArray(res.data.data) ? res.data.data.length : null;
    return { ok: true, vendor, models: count };
  } catch (err) {
    const r = err.response;
    return { ok: false, vendor, status: r && r.status, error: (r && r.data && (r.data.error && r.data.error.message || r.data.message)) || err.message };
  }
}

module.exports = {
  listFeatures, setFeature, testVendor,
  grantAccess, revokeAccess, listGrants,
  budgetStatus, setBudget, canUseFeature, isFeatureEnabled, recordUsage, listUsage,
  listVendors, getVendor, setVendor, getVendorConfig,
};
