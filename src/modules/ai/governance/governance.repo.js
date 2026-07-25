/** AI Governance repository. All SQL for feature flags, grants, budgets, usage
 *  and vendor credentials lives here (tenant-scoped ai_* tables, 0400_ai.sql). */
"use strict";
const { insertOne, page } = require("../../../shared/db/query-helpers");

// ── Feature flags ──
async function listFlags(client) {
  const { rows } = await client.query("SELECT * FROM ai_feature_flag ORDER BY feature_key");
  return rows;
}
async function getFlag(client, key) {
  const { rows } = await client.query("SELECT * FROM ai_feature_flag WHERE feature_key = $1", [key]);
  return rows[0] || null;
}
async function setFlag(client, key, fields) {
  const keys = Object.keys(fields);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE ai_feature_flag SET " + set + ", updated_at = now() WHERE feature_key = $1 RETURNING *", [key, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
/** Level-1 entitlement: is `key` switched ON in the platform-projected
 *  feature_state (the ceiling the platform console controls)? feature_state is
 *  the documented single source of truth the tenant app reads (0130). Missing
 *  row → off. */
async function featureStateOn(client, key) {
  const { rows } = await client.query("SELECT state FROM feature_state WHERE feature_key = $1", [key]);
  return rows.length > 0 && rows[0].state === "on";
}

// ── Access grants ──
const insertGrant = (client, data) => insertOne(client, "ai_access_grant", data);
async function grantFor(client, userId, featureKey) {
  const { rows } = await client.query("SELECT * FROM ai_access_grant WHERE user_id = $1 AND feature_key = $2", [userId, featureKey]);
  return rows[0] || null;
}
async function revokeGrant(client, userId, featureKey, reason, by) {
  const { rows } = await client.query(
    "UPDATE ai_access_grant SET revoked_at = now(), revoked_reason = $3, granted_by = COALESCE(granted_by,$4) WHERE user_id = $1 AND feature_key = $2 AND revoked_at IS NULL RETURNING *",
    [userId, featureKey, reason || null, by || null],
  );
  return rows[0] || null;
}
async function listGrants(client, { userId = null }) {
  const params = []; const wh = [];
  if (userId) { params.push(userId); wh.push("user_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM ai_access_grant " + where + " ORDER BY granted_at DESC", params);
  return rows;
}

// ── Budget periods + usage ──
async function activeBudget(client, onDate) {
  const { rows } = await client.query("SELECT * FROM ai_budget_period WHERE is_active = true AND period_start <= $1 AND period_end >= $1 ORDER BY period_start DESC LIMIT 1", [onDate]);
  return rows[0] || null;
}
const insertBudget = (client, data) => insertOne(client, "ai_budget_period", data);
async function spentInPeriod(client, periodId) {
  const { rows } = await client.query("SELECT COALESCE(SUM(cost_xaf),0) AS spent FROM ai_usage_ledger WHERE period_id = $1", [periodId]);
  return Number(rows[0].spent);
}
const insertUsage = (client, data) => insertOne(client, "ai_usage_ledger", data);
async function listUsage(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.user_id) { params.push(q.user_id); wh.push("user_id = $" + params.length); }
  if (q.feature_key) { params.push(q.feature_key); wh.push("feature_key = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM ai_usage_ledger " + where + " ORDER BY occurred_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

// ── Vendor credentials (api_key_enc never returned by read APIs) ──
const SAFE_VENDOR_COLS = "credential_id, vendor, display_name, endpoint_url, default_model, current_model, cost_per_1k_input_tokens, cost_per_1k_output_tokens, cost_per_audio_minute, cost_native_currency, per_vendor_monthly_cap_xaf, is_active, last_rotated_at, created_at, updated_at";
async function listVendors(client) {
  const { rows } = await client.query("SELECT " + SAFE_VENDOR_COLS + " FROM ai_vendor_credential ORDER BY vendor");
  return rows;
}
async function getVendorSafe(client, vendor) {
  const { rows } = await client.query("SELECT " + SAFE_VENDOR_COLS + " FROM ai_vendor_credential WHERE vendor = $1", [vendor]);
  return rows[0] || null;
}
async function getVendorFull(client, vendor) {
  const { rows } = await client.query("SELECT * FROM ai_vendor_credential WHERE vendor = $1", [vendor]);
  return rows[0] || null;
}
async function upsertVendor(client, vendor, fields) {
  const cols = Object.keys(fields);
  const insertCols = ["vendor", ...cols].join(", ");
  const insertVals = ["$1", ...cols.map((_, i) => "$" + (i + 2))].join(", ");
  const updateSet = cols.map((k) => k + " = EXCLUDED." + k).join(", ");
  const { rows } = await client.query(
    "INSERT INTO ai_vendor_credential (" + insertCols + ") VALUES (" + insertVals + ") " +
      "ON CONFLICT (vendor) DO UPDATE SET " + updateSet + ", updated_at = now() " +
      "RETURNING " + SAFE_VENDOR_COLS,
    [vendor, ...cols.map((k) => fields[k])],
  );
  return rows[0];
}

module.exports = {
  listFlags, getFlag, setFlag, featureStateOn,
  insertGrant, grantFor, revokeGrant, listGrants,
  activeBudget, insertBudget, spentInPeriod, insertUsage, listUsage,
  listVendors, getVendorSafe, getVendorFull, upsertVendor,
};
