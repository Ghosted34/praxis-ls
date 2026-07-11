/**
 * Employee master pure rules (MOD-02). No I/O — deterministic helpers the
 * service composes. Keeps CNPS risk-class defaults and bank-block shape in one
 * testable place (KB §9.1 work-injury categories).
 */
"use strict";

/**
 * CNPS work-injury (risk) class rate by employee category (KB §9.1).
 * Office staff ≈ 1.75%; drivers, warehouse and port/handling are higher-risk
 * (~2.5–5%). Returned as a decimal fraction (0.0175 = 1.75%). This is only a
 * *suggested default* when the record doesn't specify one — a tenant can always
 * override risk_class_rate per employee.
 */
const RISK_OFFICE = 0.0175;
const RISK_OPERATIONAL = 0.025;

function suggestRiskClass({ is_driver, department, employment_type } = {}) {
  if (is_driver) return RISK_OPERATIONAL;
  const hay = `${department || ""} ${employment_type || ""}`.toLowerCase();
  if (/warehouse|magasin|port|handling|manuten|logisti|fleet|driver|chauffeur/.test(hay)) {
    return RISK_OPERATIONAL;
  }
  return RISK_OFFICE;
}

/**
 * Normalise a bank block. Accepts a plain object of banking coordinates; drops
 * anything non-string and guarantees a JSON-serialisable object (schema stores
 * jsonb NOT NULL DEFAULT '{}'). Returns {} for empty/invalid input.
 */
function normaliseBankBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** Fields masked from roles without salary visibility (mirrors field_visibility 'employee.salary'). */
const SENSITIVE_FIELDS = ["base_salary", "bank_block"];

/** Return a copy with sensitive fields stripped, for callers that can't see salary. */
function redactSensitive(row) {
  if (!row) return row;
  const clone = { ...row };
  for (const f of SENSITIVE_FIELDS) delete clone[f];
  return clone;
}

module.exports = { suggestRiskClass, normaliseBankBlock, redactSensitive, SENSITIVE_FIELDS, RISK_OFFICE, RISK_OPERATIONAL };
