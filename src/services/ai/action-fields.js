/**
 * Interactive action forms — field metadata for the copilot (AI_ARCHITECTURE §7).
 *
 * When the assistant proposes a create/post action, the copilot renders a typed
 * FORM instead of asking the user to type raw values: enum fields become
 * dropdowns from the schema, and reference fields (client_id, entity_id, …)
 * become dropdowns populated live from the matching list-read.
 *
 * The field → list-read mapping is CONVENTION-first (client_id → list_clients)
 * with an OVERRIDES map for the irregular ones (grn_id → list_goods_received),
 * and is only used when the resolved read is actually available (ai_enabled) for
 * the caller — so a field never advertises a picker the runtime can't serve.
 */
"use strict";

// Irregular field → list-read mappings the pluralisation convention can't derive.
const OVERRIDES = {
  owner_ops_id: "list_users",
  owner_sales_id: "list_users",
  owner_id: "list_users",
  requested_by: "list_users",
  assigned_to: "list_users",
  user_id: "list_users",
  grn_id: "list_goods_received",
  pr_id: "list_purchase_requests",
  po_id: "list_purchase_orders",
  dossier_id: "list_dossiers",
  costing_id: "list_costings",
  service_type_id: "list_service_types",
  entity_id: "list_entities",
  connection_id: "list_mail_connections",
  item_id: "list_inventory",
  account_id: "list_accounts",
  treasury_account_id: "list_treasury_accounts",
  jurisdiction_id: "list_tax_jurisdictions",
  employee_id: "list_employees",
};

const IRREGULAR_PLURAL = { entity: "entities" };

function pluralize(word) {
  if (IRREGULAR_PLURAL[word]) return IRREGULAR_PLURAL[word];
  if (/y$/.test(word)) return word.replace(/y$/, "ies"); // currency→currencies, opportunity→opportunities
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** A field that plausibly references another record. */
function isRefField(key) {
  return key.endsWith("_id") || key.endsWith("_by") || key in OVERRIDES;
}

/**
 * The list-read that supplies options for a reference field, or null.
 * `availableReads` is the set of read action_keys that are ai_enabled for the
 * caller — the resolved read must be in it, else we return null (no picker).
 */
function resolveRef(key, availableReads) {
  const inSet = (k) => k && availableReads && availableReads.has(k);
  if (OVERRIDES[key] && inSet(OVERRIDES[key])) return OVERRIDES[key];
  const base = key.replace(/_id$/, "");
  const candidates = [`list_${pluralize(base)}`, `list_${base}s`, `list_${base}`];
  return candidates.find(inSet) || null;
}

/** "service_type_id" → "Service Type"; "bl_mawb" → "Bl Mawb". */
function humanize(key) {
  return key
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Per-field UI hints for one action's payload schema. Widget is `select` for
 * enums (options carried inline) and for reference fields (options fetched from
 * `ref` via /ai/options), `number` for numeric fields, else `text`.
 */
function buildFieldMeta(schema, availableReads) {
  const meta = {};
  if (!schema || !schema.properties) return meta;
  const required = new Set(schema.required || []);
  for (const [key, prop] of Object.entries(schema.properties)) {
    // Free-form structured fields (object/array — e.g. a `client` record or an
    // invoice `lines` list) have no sensible single-input widget. Omit them from
    // the form; whatever the model pre-filled is carried through on submit.
    if (prop && (prop.type === "object" || prop.type === "array")) continue;
    const base = { label: humanize(key), required: required.has(key) };
    if (Array.isArray(prop.enum) && prop.enum.length) {
      meta[key] = { ...base, widget: "select", options: prop.enum.map((v) => ({ value: v, label: String(v) })) };
    } else if (prop.type === "number" || prop.type === "integer") {
      meta[key] = { ...base, widget: "number" };
    } else if (isRefField(key)) {
      const ref = resolveRef(key, availableReads);
      meta[key] = ref ? { ...base, widget: "select", ref } : { ...base, widget: "text" };
    } else {
      meta[key] = { ...base, widget: "text" };
    }
  }
  return meta;
}

// Preferred label columns, best first: a business name before a code/ref, and
// only fall back to email/number when nothing more human exists. Many entities
// use a qualified *_name (company_name, legal_name, supplier_name) rather than a
// bare `name`, so those are matched too.
const ID_KEYS = [
  "name", "company_name", "legal_name", "supplier_name", "client_name", "full_name",
  "display_name", "title", "label", "ref", "reference", "number", "doc_number", "code", "plate", "email",
];

/**
 * Map raw read rows to {value, label} option pairs. Value = the row's id-like
 * field (a *_id column, or `id`); label = the first human-readable column
 * present, falling back to the value so an option is never blank.
 */
function rowsToOptions(data, limit = 100) {
  const rows = Array.isArray(data) ? data : Array.isArray(data && data.rows) ? data.rows : Array.isArray(data && data.items) ? data.items : [];
  return rows.slice(0, limit).map((row) => {
    if (row === null || typeof row !== "object") return { value: row, label: String(row) };
    const idKey = Object.keys(row).find((k) => k.endsWith("_id")) || (row.id !== undefined ? "id" : null);
    const value = idKey ? row[idKey] : row.value !== undefined ? row.value : JSON.stringify(row);
    const labelKey = ID_KEYS.find((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");
    const label = labelKey ? String(row[labelKey]) : String(value);
    return { value, label };
  });
}

module.exports = { buildFieldMeta, resolveRef, rowsToOptions, isRefField };
