/**
 * Notification category catalog — the single source of truth for the coarse
 * buckets a user tunes in their notification Preferences. Event types are
 * fine-grained (`invoice.posted`, `vehicle.insurance.expiring`, …); categories
 * are the handful of groups a human actually wants to switch on/off.
 *
 * Every notification is tagged with a category at write time (derived from its
 * event_type_key via categoryFor), so:
 *   - the inbox can filter by category, and
 *   - the producer can consult the user's per-(channel,category) preference
 *     before delivering — EXCEPT `security`, which is unconditional.
 *
 * The FE fetches this list from GET /notifications/categories, so the UI and the
 * enforcement logic never drift apart.
 */
"use strict";

// key → { label, security }. `security: true` means "cannot be silenced".
// Order here is the display order in the Preferences table.
const CATEGORIES = [
  { key: "security", label: "Security", security: true },
  { key: "approvals", label: "Approvals", security: false },
  { key: "finance", label: "Finance", security: false },
  { key: "operations", label: "Operations", security: false },
  { key: "sales", label: "Sales & CRM", security: false },
  { key: "compliance", label: "Compliance", security: false },
  { key: "system", label: "System", security: false },
];

const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
const SECURITY_CATEGORIES = new Set(CATEGORIES.filter((c) => c.security).map((c) => c.key));

// Leading domain segment (before the first ".") → category. Anything unmapped
// falls back to "system", so a new event type is never dropped — it just lands
// in the general bucket until it's classified here.
const DOMAIN_TO_CATEGORY = {
  // security & access
  auth: "security", permission: "security", role: "security", field_visibility: "security",
  capability: "security", app_user: "security", audit_ledger: "security", session: "security",
  scope: "security", setting: "security", iam: "security", godmode: "security", numbering_setting: "security",

  // approvals & disbursement
  approval: "approvals", workflow: "approvals", costing: "approvals", cash_request: "approvals",
  disbursal: "approvals", advance: "approvals",

  // finance & accounting
  invoice: "finance", payment: "finance", journal: "finance", gl: "finance", account: "finance",
  credit_note: "finance", proforma: "finance", debt: "finance", period: "finance",
  tax_declaration: "finance", asset: "finance", payroll: "finance", fx: "finance", cost: "finance",

  // operations, logistics, HR, procurement
  dossier: "operations", delivery_note: "operations", grn: "operations", po: "operations",
  cycle_count: "operations", milestone: "operations", vehicle: "operations", driver: "operations",
  attendance: "operations", supplier: "operations", supplier_invoice: "operations",
  employee: "operations", appraisal: "operations", procurement: "operations", wms: "operations",
  fleet: "operations", operations: "operations", master: "operations",
  transit_order: "operations", inbound: "operations", equipment: "operations", inventory: "operations",
  goods_received: "operations", purchase_order: "operations", purchase_request: "operations",
  hr_contract: "operations", leave_allowance: "operations", vacancy: "operations", training: "operations",
  incident: "operations", work_order: "operations", fuel_log: "operations",

  // sales & CRM
  client: "sales", lead: "sales", campaign: "sales", contact_enquiry: "sales",
  quote: "sales", sales: "sales", commercial: "sales",
  opportunity: "sales", proposal: "sales", meeting: "sales", partnership_request: "sales",
  newsletter: "sales", success_story: "sales",

  // compliance & documents
  compliance_flag: "compliance", document: "compliance", document_vault: "compliance", vault: "compliance",
  /*
   * DOCUMENT signatures — somebody attesting to an invoice — not the mail
   * programme's `signature.*`, which is the sign-off block on an outgoing
   * message and lands in "system" where it belongs. The two share a word and
   * nothing else; without this row every scan notification would file itself
   * under System, next to cache invalidations.
   */
  document_signature: "compliance",

  // system / misc
  ai: "system", comms: "system", dashboard: "system", dictionary_item: "system", notification: "system",
  branding: "system",
};

/** Map an event_type_key (or bare domain) to its category. Never throws; unknown
 *  domains → "system". */
function categoryFor(eventTypeKey) {
  const domain = String(eventTypeKey || "").split(".")[0].toLowerCase();
  return DOMAIN_TO_CATEGORY[domain] || "system";
}

/** True when a category is security-critical and therefore ignores preferences. */
function isSecurityCategory(category) {
  return SECURITY_CATEGORIES.has(String(category || ""));
}

/** True when a string is one of the known category keys. */
function isKnownCategory(category) {
  return CATEGORY_KEYS.has(String(category || ""));
}

module.exports = { CATEGORIES, categoryFor, isSecurityCategory, isKnownCategory };
