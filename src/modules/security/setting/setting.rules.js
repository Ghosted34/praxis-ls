/**
 * Settings hub (MOD-70) — pure validation. Settings are keyed by (section, key)
 * with a jsonb value. Known sections are advisory (arbitrary sections allowed for
 * forward-compat), but a value must always be a JSON object, and a few sections
 * get a light shape check so a bad numbering scheme / cap can't be saved.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const KNOWN_SECTIONS = [
  "appearance", "legal", "finance", "comms", "email", "fx", "workflow",
  "numbering", "commercial", "procurement", "security", "ai",
  // Pixie-parity gap-fixes hosted in the generic setting store:
  "document_template", "custom_field", "integration_secret", "email_signature",
];

// document_template.status vocabulary and custom_field.field_type vocabulary —
// enforced so a consuming module can trust the shape it reads back (see
// doc/GAP_FIXES_PLAN.md §1.1 / §2.2 and the "settings must be enforced" rule).
const TEMPLATE_STATUS = ["draft", "published", "archived"];
const FIELD_TYPES = ["text", "number", "boolean", "date", "select", "multiselect"];

function assertValue(section, key, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    // arrays are allowed for a few list-style settings (e.g. dunning policy)
    // and for custom_field, whose value is an array of field definitions.
    const listOk = ["finance", "commercial"].includes(section)
      || section === "custom_field"
      || key.endsWith("_policy") || key.endsWith("_tiers");
    if (!(Array.isArray(value) && listOk)) {
      throw new AppError("BAD_VALUE", "a setting value must be a JSON object (or a list for policy/tier/custom_field settings)", 422);
    }
  }
  if (section === "numbering" && value && typeof value === "object" && !Array.isArray(value)) {
    if (value.padding !== undefined && (typeof value.padding !== "number" || value.padding < 0 || value.padding > 12)) {
      throw new AppError("BAD_SCHEME", "numbering.padding must be 0–12", 422);
    }
    if (value.reset !== undefined && !["never", "yearly", "monthly"].includes(value.reset)) {
      throw new AppError("BAD_SCHEME", "numbering.reset must be never|yearly|monthly", 422);
    }
  }

  // Document templates (1.1) — one key per doc_type; the stored value is the
  // template the issuing module renders. Shape-checked so a consumer can rely
  // on { name, status, body_html }.
  if (section === "document_template" && value && typeof value === "object" && !Array.isArray(value)) {
    if (!value.name || typeof value.name !== "string") {
      throw new AppError("BAD_TEMPLATE", "document_template.name is required", 422);
    }
    if (value.status !== undefined && !TEMPLATE_STATUS.includes(value.status)) {
      throw new AppError("BAD_TEMPLATE", "document_template.status must be " + TEMPLATE_STATUS.join("|"), 422);
    }
    if (value.body_html !== undefined && value.body_html !== null && typeof value.body_html !== "string") {
      throw new AppError("BAD_TEMPLATE", "document_template.body_html must be a string", 422);
    }
    if (value.css_vars !== undefined && (typeof value.css_vars !== "object" || Array.isArray(value.css_vars))) {
      throw new AppError("BAD_TEMPLATE", "document_template.css_vars must be an object", 422);
    }
  }

  // Email signature brand template (2.1) — tenant-wide template stored at
  // key='template'; the per-user render lives on app_user (email_signature table).
  if (section === "email_signature" && value && typeof value === "object" && !Array.isArray(value)) {
    if (value.html !== undefined && value.html !== null && typeof value.html !== "string") {
      throw new AppError("BAD_SIGNATURE", "email_signature.html must be a string", 422);
    }
  }

  // Custom field definitions (2.2) — value is an array of field defs for the
  // entity_type named by `key`; each def needs a stable key + a known type.
  if (section === "custom_field") {
    if (!Array.isArray(value)) {
      throw new AppError("BAD_CUSTOM_FIELD", "custom_field value must be an array of field definitions", 422);
    }
    const seen = new Set();
    for (const d of value) {
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        throw new AppError("BAD_CUSTOM_FIELD", "each custom field must be an object", 422);
      }
      if (!d.field_key || typeof d.field_key !== "string") {
        throw new AppError("BAD_CUSTOM_FIELD", "each custom field needs a string field_key", 422);
      }
      if (seen.has(d.field_key)) {
        throw new AppError("BAD_CUSTOM_FIELD", "duplicate custom field_key '" + d.field_key + "'", 422);
      }
      seen.add(d.field_key);
      if (!d.field_type || !FIELD_TYPES.includes(d.field_type)) {
        throw new AppError("BAD_CUSTOM_FIELD", "custom field '" + d.field_key + "' field_type must be " + FIELD_TYPES.join("|"), 422);
      }
    }
  }
  return true;
}

module.exports = { KNOWN_SECTIONS, TEMPLATE_STATUS, FIELD_TYPES, assertValue };
