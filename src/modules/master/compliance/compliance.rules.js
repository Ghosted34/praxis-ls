/**
 * Party compliance engine — PURE rules (spec §4.1, Hard Rules 3 & 9).
 *
 * Given a party and its documents, banks, expected document types, and (for a
 * client) its credit status, this returns the compliance FLAGS, the rolled-up
 * `compliance_state`, and whether the party is eligible to reach VERIFIED.
 *
 * THE LADDER. INFO (data quality) · WARN (expiring <30d, an optional document
 * missing, a scan still pending) · ESCALATED (a mandatory document missing or
 * expired, a scan past its SLA, an unverified bank, a screening hit) ·
 * SOFT_BLOCK_RECOMMENDATION (over the credit limit, high-risk). A rule NEVER
 * returns HARD_BLOCK — that is only ever applied by a human through
 * POST /:id/block (Hard Rule 3). This function cannot express it.
 *
 * THE SCAN GATE (Hard Rule 9). A document with no `vault_id` (paper-only) is
 * allowed to exist — freight must move — but it raises WARN immediately and
 * ESCALATED once `scan_due_on` has passed, and it holds the party back from
 * VERIFIED: `can_verify` is false until every MANDATORY document type has a
 * document that is both scanned (`vault_id`) and `VERIFIED`. A physical archive
 * reference is supplementary, never a substitute.
 *
 * "Mandatory" is not hard-coded: a document type is mandatory when its
 * configured `default_severity` is ESCALATED and it applies to this party — so
 * what is required stays tenant configuration (Hard Rule 10).
 */
"use strict";

/** Rank a severity so the worst one wins the rolled-up state. RED (the legacy
 *  GL-integrity severity) ranks with ESCALATED. */
const SEVERITY_RANK = { INFO: 0, WARN: 1, RED: 2, ESCALATED: 2, SOFT_BLOCK_RECOMMENDATION: 3, HARD_BLOCK: 4 };
const RANK_STATE = ["OK", "WARN", "ESCALATED", "SOFT_BLOCK_RECOMMENDATION", "HARD_BLOCK"];

const DEFAULT_EXPIRY_WARN_DAYS = 30;

function parseDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days from `today` until `dateVal` (negative = already past), or null. */
function daysUntil(dateVal, today) {
  const d = parseDate(dateVal);
  if (!d) return null;
  return Math.floor((d.getTime() - today.getTime()) / 86_400_000);
}

const appliesToParty = (dt, appliesTo) => dt.applies_to === "BOTH" || dt.applies_to === appliesTo;

/** The rolled-up state: the worst flag severity, mapped to a compliance_state. */
function stateFor(flags) {
  let rank = 0;
  for (const f of flags) rank = Math.max(rank, SEVERITY_RANK[f.severity] || 0);
  return RANK_STATE[rank];
}

/** The document types that MUST be present, scanned and verified for this party. */
function mandatoryTypes(docTypes, appliesTo) {
  return (docTypes || []).filter(
    (dt) => dt.is_active !== false && appliesToParty(dt, appliesTo) && (dt.default_severity || "") === "ESCALATED",
  );
}

/**
 * Whether the party can reach VERIFIED / supplier AVL-APPROVED. False while any
 * mandatory document type lacks a scanned+verified document, or a screening hit
 * is open. This is the transactional gate the service consults before allowing a
 * verification transition (Hard Rule 9).
 */
function canVerify({ appliesTo, party, documents, docTypes }) {
  if (party && (party.screen_status === "HIT" || party.screen_status === "SANCTIONS_HIT")) return false;
  const need = mandatoryTypes(docTypes, appliesTo);
  return need.every((dt) =>
    (documents || []).some(
      (d) => d.document_type_id === dt.document_type_id && d.vault_id && d.verification_status === "VERIFIED",
    ),
  );
}

/**
 * Evaluate a party.
 *
 * @returns {{flags: Array<{rule_key,severity,message}>, compliance_state: string, can_verify: boolean}}
 */
function evaluate({ appliesTo, party = {}, documents = [], docTypes = [], banks = [], creditStatus = null, today, expiryWarnDays = DEFAULT_EXPIRY_WARN_DAYS }) {
  const t = today ? parseDate(today) || new Date() : new Date();
  const active = (docTypes || []).filter((dt) => dt.is_active !== false && appliesToParty(dt, appliesTo));
  const typeById = new Map(active.map((dt) => [dt.document_type_id, dt]));
  const flags = [];

  // Missing expected documents — severity follows the type's default_severity.
  const present = new Set((documents || []).map((d) => d.document_type_id));
  for (const dt of active) {
    if (!present.has(dt.document_type_id)) {
      flags.push({ rule_key: "party.doc_missing", severity: dt.default_severity || "WARN", message: `Missing ${dt.name || "document"}` });
    }
  }

  // Per-document: expiry, rejection, and the digital-scan gate.
  for (const d of documents || []) {
    const name = (typeById.get(d.document_type_id) || {}).name || "document";
    if (d.expires_on) {
      const du = daysUntil(d.expires_on, t);
      if (du !== null && du < 0) flags.push({ rule_key: "party.doc_expired", severity: "ESCALATED", message: `${name} expired` });
      else if (du !== null && du <= expiryWarnDays) flags.push({ rule_key: "party.doc_expiring", severity: "WARN", message: `${name} expires in ${du}d` });
    }
    if (d.scan_status === "REJECTED" || d.verification_status === "REJECTED") {
      flags.push({ rule_key: "party.doc_rejected", severity: "ESCALATED", message: `${name} rejected` });
    } else if (!d.vault_id) {
      // Paper-only: allowed to exist, but WARN now / ESCALATED past the SLA.
      const du = daysUntil(d.scan_due_on, t);
      if (d.scan_due_on && du !== null && du < 0) {
        flags.push({ rule_key: "party.scan_overdue", severity: "ESCALATED", message: `${name} digital scan overdue` });
      } else {
        flags.push({ rule_key: "party.scan_pending", severity: "WARN", message: `${name} awaiting digital scan` });
      }
    }
  }

  // Unverified bank accounts — BEC fraud control.
  for (const b of banks || []) {
    if (b.is_active !== false && !b.is_verified) {
      flags.push({ rule_key: "party.bank_unverified", severity: "ESCALATED", message: `Unverified bank account${b.bank_name ? ` (${b.bank_name})` : ""}` });
    }
  }

  // Screening / sanctions.
  if (party.screen_status === "HIT" || party.screen_status === "SANCTIONS_HIT") {
    flags.push({ rule_key: "party.sanctions_hit", severity: "ESCALATED", message: "Screening / sanctions hit — review required" });
  }

  // Credit exposure over the limit (client) — a recommendation, never a hard block.
  if (creditStatus && creditStatus.within === false) {
    flags.push({ rule_key: "party.credit_over_limit", severity: "SOFT_BLOCK_RECOMMENDATION", message: "Credit exposure exceeds the limit" });
  }

  // High-risk tier.
  if (party.risk_tier && String(party.risk_tier).toUpperCase() === "HIGH") {
    flags.push({ rule_key: "party.high_risk", severity: "SOFT_BLOCK_RECOMMENDATION", message: "High-risk party — enhanced due diligence" });
  }

  // Data-quality INFO (never affects the state beyond OK).
  if (!party.legal_name) flags.push({ rule_key: "party.missing_legal_name", severity: "INFO", message: "Legal name not set" });

  return { flags, compliance_state: stateFor(flags), can_verify: canVerify({ appliesTo, party, documents, docTypes }) };
}

module.exports = {
  SEVERITY_RANK,
  RANK_STATE,
  DEFAULT_EXPIRY_WARN_DAYS,
  parseDate,
  daysUntil,
  appliesToParty,
  stateFor,
  mandatoryTypes,
  canVerify,
  evaluate,
};
