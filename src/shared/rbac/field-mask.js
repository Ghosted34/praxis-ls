/**
 * Field-level confidentiality serializer (PRD §5.6/§7.3 [RULE]). The RBAC engine
 * stores which field_keys each role may NOT see (`field_visibility`, seeded in
 * 9020). This is the response-side enforcement the doc requires: given the
 * caller's masked field_keys, null out the mapped response properties before the
 * data leaves the API. Enforcement is server-side; the UI only reflects it.
 *
 * Masking nulls (does not delete) so response shape is preserved, and walks
 * nested objects/arrays so a masked figure hidden inside a money block (e.g. the
 * dossier-360 modal) is caught wherever it appears.
 */
"use strict";

// field_visibility.field_key → the concrete response property names it governs.
const FIELD_MAP = {
  "employee.salary": ["base_salary", "salary", "gross", "net_pay", "bank_block", "bank_account", "bank_details"],
  "dossier.margin": ["margin", "margin_percent", "net_profit", "profit", "dossier_margin", "gross_margin", "result"],
  "supplier.cost_rate": ["cost_rate", "cost_rates", "unit_cost", "supplier_cost"],
  "gl.account": ["account_code", "account", "gl_account"],
};

/** Build the flat set of response property names masked for these field_keys. */
function maskedPropsFor(maskedKeys = []) {
  const props = new Set();
  for (const k of maskedKeys) for (const p of (FIELD_MAP[k] || [])) props.add(p);
  return props;
}

/** Deep-null any property in `propSet`, recursing through arrays/objects. */
function applyMask(value, propSet) {
  if (Array.isArray(value)) return value.map((v) => applyMask(v, propSet));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = propSet.has(k) ? null : applyMask(v, propSet);
    }
    return out;
  }
  return value;
}

/** Mask `data` for a caller who may not see `maskedKeys`. No keys → unchanged. */
function maskData(data, maskedKeys = []) {
  const propSet = maskedPropsFor(maskedKeys);
  if (propSet.size === 0) return data;
  return applyMask(data, propSet);
}

/**
 * HTTP-boundary helper: resolve the caller's masked field_keys from the tenant
 * connection and mask `data`. Apply in controllers on sensitive reads — NOT in
 * services (internal callers such as payroll need the real base_salary). CEO is
 * unrestricted by design (and carries no masked rows anyway).
 */
async function maskForUser(client, user, data) {
  const userId = user && (user.user_id || user.id);
  if (!userId || user.is_ceo) return data;
  // eslint-disable-next-line global-require
  const identity = require("../cache/identity-cache");
  const keys = await identity.getMaskedFieldKeys(client, userId);
  return maskData(data, keys);
}

module.exports = { FIELD_MAP, maskedPropsFor, applyMask, maskData, maskForUser };
