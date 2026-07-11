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
];

function assertValue(section, key, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    // arrays are allowed for a few list-style settings (e.g. dunning policy)
    const listOk = ["finance", "commercial"].includes(section) || key.endsWith("_policy") || key.endsWith("_tiers");
    if (!(Array.isArray(value) && listOk)) {
      throw new AppError("BAD_VALUE", "a setting value must be a JSON object (or a list for policy/tier settings)", 422);
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
  return true;
}

module.exports = { KNOWN_SECTIONS, assertValue };
