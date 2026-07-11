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
const { estimateCostXaf, capState, canUse } = require("./governance.rules");
const encryption = require("../../../services/encryption.service");
const axios = require("axios");
const { emitEvent, audit } = require("../../../shared/events/emit");
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
  const row = await repo.insertGrant(client, { user_id: userId, feature_key: featureKey, monthly_cap_xaf: monthlyCapXaf, granted_by: actor.user_id || null });
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
  const row = await repo.insertBudget(client, { period_start: periodStart, period_end: periodEnd, soft_cap_xaf: softCapXaf, hard_cap_xaf: hardCapXaf, set_by: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.BUDGET_SET, moduleKey: events.MODULE, entityRef: "ai_budget:" + row.period_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.BUDGET_SET, moduleKey: events.MODULE, entityRef: "ai_budget:" + row.period_id, after: row });
  return row;
}

/** The gate every AI entry point calls: is this user allowed to use this feature now? */
async function canUseFeature(client, { userId, featureKey, onDate = null }) {
  const flag = await repo.getFlag(client, featureKey);
  const grant = userId ? await repo.grantFor(client, userId, featureKey) : null;
  const budget = await budgetStatus(client, { onDate });
  const verdict = canUse({ flag, grant, budgetState: budget.state });
  return { ...verdict, feature_key: featureKey, budget_state: budget.state, spent_xaf: budget.spent_xaf };
}

/** Append a usage row against the active budget period (cost accounting). */
async function recordUsage(client, { userId = null, featureKey = null, conversationId = null, provider = null, model = null, callType = null, inputTokens = 0, outputTokens = 0, audioSeconds = 0, costXaf = null, costNative = 0, costNativeCurrency = null, latencyMs = null, wasSuccessful = true, errorCode = null, errorMessage = null, onDate = null }) {
  const date = onDate || today();
  const period = await repo.activeBudget(client, date);
  let cost = costXaf;
  if (cost === null || cost === undefined) {
    const vendor = provider ? await repo.getVendorSafe(client, provider) : null;
    cost = vendor ? estimateCostXaf({ inputTokens, outputTokens, audioSeconds, vendor, fxToXaf: 1 }) : 0;
  }
  const row = await repo.insertUsage(client, {
    user_id: userId, feature_key: featureKey, conversation_id: conversationId, period_id: period ? period.period_id : null,
    provider, model, call_type: callType, audio_seconds: audioSeconds, input_tokens: inputTokens, output_tokens: outputTokens,
    total_tokens: Number(inputTokens) + Number(outputTokens), cost_native: costNative, cost_native_currency: costNativeCurrency,
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
  budgetStatus, setBudget, canUseFeature, recordUsage, listUsage,
  listVendors, getVendor, setVendor, getVendorConfig,
};
