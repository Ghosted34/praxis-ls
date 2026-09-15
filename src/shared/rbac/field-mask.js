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
  "employee.salary": [
    "base_salary", "salary", "gross", "net_pay", "bank_block", "bank_account", "bank_details",
    // 12765: a standing allowance IS pay. A role that cannot see a base salary
    // must not read the responsibility allowance instead and add it up.
    // `amount` is deliberately NOT here — it is far too generic a property name
    // to null across every nested object in every response; the allowance
    // endpoints redact it explicitly, via maskedKeysFor.
    "monthly_gross",
  ],
  /*
   * 12763's civil-identity block. Separate from `employee.salary` because they
   * are different confidences with different audiences: a payroll clerk needs
   * the salary and has no business with a parent's name or a home address,
   * while a line manager may need neither. Nothing masks this key until an
   * administrator says so on the Field visibility screen — adding the key here
   * makes the choice AVAILABLE, it does not make it.
   */
  "employee.personal": [
    "date_of_birth", "place_of_birth", "father_name", "mother_name", "maiden_name",
    "marital_status", "dependent_children", "id_document_number", "id_document_issued_on",
    "id_document_issued_at", "id_document_expires_on", "residence_address", "residence_city",
    "personal_email", "phone_whatsapp",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
  ],
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

/**
 * Names that must never be written from data we did not author. `out[k] = v`
 * with k = "__proto__" invokes the prototype setter instead of adding a
 * property, and the masked copy then inherits whatever was there.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep-null any property in `propSet`, recursing through arrays/objects.
 *
 *  Built with `Object.fromEntries` rather than bracket assignment: the keys
 *  walked here are row keys, and a row carries jsonb blobs (`bank_block`) whose
 *  contents a caller supplied. fromEntries defines rather than sets, so no
 *  prototype setter can fire on the way out. */
function applyMask(value, propSet) {
  if (Array.isArray(value)) return value.map((v) => applyMask(v, propSet));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !UNSAFE_KEYS.has(k))
        .map(([k, v]) => [k, propSet.has(k) ? null : applyMask(v, propSet)]),
    );
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
  const identity = require("../cache/identity-cache");
  const keys = await identity.getMaskedFieldKeys(client, userId);
  return maskData(data, keys);
}

/**
 * Same as maskForUser but resolves the masked field_keys from the env-INDEPENDENT
 * identity schema. Use this when the response `data` was read on the env-scoped
 * business client (req.tenantDb): `field_visibility` lives in the live/identity
 * schema, so masking must be resolved there — otherwise a LIVE→TEST toggle would
 * read an empty sandbox `field_visibility` and silently stop masking. `identityDb`
 * is `req.identityDb` (the always-live connection runner). getMaskedFieldKeys is
 * Redis-cached (30 s), so this is typically a cache hit, not a DB round-trip.
 */
async function maskForUserVia(identityDb, user, data) {
  const userId = user && (user.user_id || user.id);
  if (!userId || user.is_ceo) return data;
  const identity = require("../cache/identity-cache");
  const keys = await identityDb((client) => identity.getMaskedFieldKeys(client, userId));
  return maskData(data, keys);
}

/**
 * The caller's masked field_keys, for the handful of responses that cannot be
 * masked by property name alone.
 *
 * `employee_allowance.amount` is the case this exists for: "amount" appears on
 * invoices, receipts, payments and journal lines, so putting it in FIELD_MAP
 * would null a figure on half the product for anybody masked on salary. The
 * allowance endpoints ask this instead and redact their own column.
 */
async function maskedKeysFor(identityDb, user) {
  const userId = user && (user.user_id || user.id);
  if (!userId || user.is_ceo) return [];
  const identity = require("../cache/identity-cache");
  return identityDb((client) => identity.getMaskedFieldKeys(client, userId));
}

module.exports = { FIELD_MAP, maskedPropsFor, applyMask, maskData, maskForUser, maskForUserVia, maskedKeysFor };
