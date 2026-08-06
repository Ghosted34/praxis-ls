"use strict";
/**
 * Configurable field-requirements — the runtime half of spec §5.
 *
 * The Zod schemas (client-master.js / supplier-master.js) answer "is this a
 * well-SHAPED client payload". They deliberately do NOT answer "did this tenant
 * require an NIU", because that is policy, not shape, and it changes per tenant
 * from Settings → Master Data. `party_field_config` holds that policy; this
 * module applies it, on the SERVER (the API is the enforcement point) and — for
 * PR 2 — on the form, from one definition so the two cannot disagree
 * (acceptance gate 7).
 *
 * Pure: it takes the tenant's config rows and a parsed payload and returns what
 * is missing. The API loads the rows (master_config.repo) and calls
 * `checkRequired`; if the tenant has no rows at all it falls back to
 * `DEFAULTS`, which mirrors the seed in 0511 so a fresh tenant with no setup
 * still validates.
 */

/**
 * Seeded defaults — the SAME set 0511 writes into party_field_config. Kept here
 * as the fallback for a tenant whose config table is somehow empty, and as the
 * source PR 2's form reads when the API has not answered yet. `[applies_to,
 * field_key, field_group, is_required]`; everything unlisted defaults to
 * visible + optional.
 */
const DEFAULT_ROWS = [
  ["CLIENT", "name", "IDENTITY", true],
  ["CLIENT", "legal_name", "IDENTITY", false],
  ["CLIENT", "trading_name", "IDENTITY", false],
  ["CLIENT", "client_type_id", "IDENTITY", false],
  ["CLIENT", "industry", "IDENTITY", false],
  ["CLIENT", "website", "IDENTITY", false],
  ["CLIENT", "niu", "IDENTITY", false],
  ["CLIENT", "rccm", "IDENTITY", false],
  ["CLIENT", "tax_residency_country", "COMPLIANCE", false],
  ["CLIENT", "risk_tier", "COMPLIANCE", false],
  ["CLIENT", "registrations", "COMPLIANCE", false],
  ["CLIENT", "beneficial_owners", "COMPLIANCE", false],
  ["CLIENT", "documents", "COMPLIANCE", false],
  ["CLIENT", "contacts.billing", "CONTACT", false],
  ["CLIENT", "addresses.registered", "ADDRESS", false],
  ["CLIENT", "bank_accounts", "BANK", false],
  ["CLIENT", "credit_limit", "ACCOUNTING", false],
  ["CLIENT", "payment_terms_days", "ACCOUNTING", false],
  ["CLIENT", "is_withholding_agent", "ACCOUNTING", false],
  ["CLIENT", "default_currency", "ACCOUNTING", false],
  ["CLIENT", "relationship_manager_user_id", "IDENTITY", false],
  ["SUPPLIER", "name", "IDENTITY", true],
  ["SUPPLIER", "legal_name", "IDENTITY", false],
  ["SUPPLIER", "trading_name", "IDENTITY", false],
  ["SUPPLIER", "supplier_type_id", "IDENTITY", false],
  ["SUPPLIER", "industry", "IDENTITY", false],
  ["SUPPLIER", "website", "IDENTITY", false],
  ["SUPPLIER", "niu", "IDENTITY", false],
  ["SUPPLIER", "rccm", "IDENTITY", false],
  ["SUPPLIER", "tax_residency_country", "COMPLIANCE", false],
  ["SUPPLIER", "is_non_resident", "COMPLIANCE", false],
  ["SUPPLIER", "registrations", "COMPLIANCE", false],
  ["SUPPLIER", "beneficial_owners", "COMPLIANCE", false],
  ["SUPPLIER", "documents", "COMPLIANCE", false],
  ["SUPPLIER", "contacts.operations", "CONTACT", false],
  ["SUPPLIER", "addresses.registered", "ADDRESS", false],
  ["SUPPLIER", "bank_accounts", "BANK", false],
  ["SUPPLIER", "payment_method", "ACCOUNTING", false],
  ["SUPPLIER", "payment_terms_days", "ACCOUNTING", false],
  ["SUPPLIER", "withholding_rate", "ACCOUNTING", false],
  ["SUPPLIER", "default_currency", "ACCOUNTING", false],
  ["SUPPLIER", "avl_status", "COMPLIANCE", false],
];

/** The stable order groups render in on the settings page. */
const GROUP_ORDER = ["IDENTITY", "CONTACT", "ADDRESS", "BANK", "ACCOUNTING", "COMPLIANCE"];

/** The seeded defaults for one side, as config-row objects. */
function defaultsFor(appliesTo) {
  const want = String(appliesTo || "").toUpperCase();
  return DEFAULT_ROWS.filter(([a]) => a === want).map(([applies_to, field_key, field_group, is_required], i) => ({
    applies_to,
    field_key,
    field_group,
    is_required,
    is_visible: true,
    is_custom: false,
    sort_order: (i + 1) * 10,
    label_override: null,
  }));
}

/**
 * The effective config for a side: the tenant's stored rows, or the seeded
 * defaults when it has none. The DB is authoritative once seeded (0511 seeds it
 * on provision), so this only falls back on a genuinely empty table.
 */
function effectiveConfig(appliesTo, dbRows) {
  return dbRows && dbRows.length ? dbRows : defaultsFor(appliesTo);
}

const isBlank = (v) => {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
};

/**
 * Resolve a config `field_key` against a payload. Scalar keys map to their
 * column (`name`, `niu`, `credit_limit`); structural keys map to the nested
 * collection the create payload may carry (`bank_accounts`, `contacts.billing`,
 * `registrations`, …) so a tenant that marks "at least one bank account
 * required" is enforced against whatever the create modal submitted.
 */
function resolveValue(data, key) {
  if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
  if (key.startsWith("contacts")) return data.contacts;
  if (key.startsWith("addresses")) return data.addresses;
  if (key === "bank_accounts") return data.bank_accounts !== undefined ? data.bank_accounts : data.banks;
  if (key === "registrations") return data.registrations;
  if (key === "documents") return data.documents;
  if (key === "beneficial_owners") {
    return data.beneficial_owners !== undefined ? data.beneficial_owners : data.beneficialOwners;
  }
  return undefined;
}

/**
 * Which required, visible fields the payload has not filled in.
 *
 * @param {object} data   the parsed payload (post-Zod)
 * @param {Array}  config the effective config rows for this side
 * @returns {{ok: boolean, missing: string[]}}
 */
function checkRequired(data, config) {
  const rows = config && config.length ? config : [];
  const missing = [];
  for (const c of rows) {
    if (!c.is_required) continue;
    if (c.is_visible === false) continue; // a hidden field cannot be demanded of a form
    if (isBlank(resolveValue(data || {}, c.field_key))) missing.push(c.field_key);
  }
  return { ok: missing.length === 0, missing };
}

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.DEFAULT_ROWS = DEFAULT_ROWS;
exports.GROUP_ORDER = GROUP_ORDER;
exports.defaultsFor = defaultsFor;
exports.effectiveConfig = effectiveConfig;
exports.checkRequired = checkRequired;
