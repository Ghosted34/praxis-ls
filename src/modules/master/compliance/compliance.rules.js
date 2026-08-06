/**
 * Party compliance engine — PURE rules (spec §4.1, Hard Rules 3 & 9; PR3 §3).
 *
 * Given a party and its documents, banks, expected document types and (for a
 * client) its credit status, this returns the compliance FLAGS, the rolled-up
 * `compliance_state`, and whether the party is eligible to reach VERIFIED.
 *
 * THE LADDER. INFO (data quality) · WARN (expiring <30d, a scan still pending) ·
 * ESCALATED (a REQUIRED document missing or expired, a scan past its SLA, an
 * unverified bank, a screening hit) · SOFT_BLOCK_RECOMMENDATION (over the credit
 * limit, high-risk). A rule NEVER returns HARD_BLOCK — that is only ever applied
 * by a human through POST /:id/block (Hard Rule 3). This function cannot express
 * it.
 *
 * REQUIRED IS NOT SEVERITY (PR3 §3.1). A document type raises a "missing"
 * flag ONLY when it is `is_required` AND it applies to this party. A type that
 * is present-but-not-required is tracked if supplied and never complained about
 * when absent — which is what stops a brand-new water supplier reading
 * "Escalated — Missing Customs Authorisation / Missing Power of Attorney". The
 * flag's SEVERITY still follows the type's `default_severity`.
 *
 * APPLICABILITY (PR3 §3.2). A required type is only considered when it applies
 * to the party's role (`applies_to`), category (`applies_to_categories`),
 * country (`applies_to_countries`) and KYC tier (`kyc_tier` ≤ party tier). Empty
 * / NULL means "applies to everyone".
 *
 * ONBOARDING vs REAL RISK (PR3 §3.3). While a party is still being onboarded
 * (registration_status DRAFT/PENDING_REVIEW, or supplier avl_status
 * PROSPECT/PENDING_KYC), if its ONLY open flags are onboarding gaps — a missing
 * required document, a scan not yet uploaded — the rolled-up state is the
 * neutral `ONBOARDING`, not `ESCALATED`: those are the checklist to activate,
 * not a compliance failure. Anything real (expiry, a rejected doc, an
 * unverified bank, a sanctions hit, credit over the limit, a GL mismatch, an
 * overdue scan) escalates regardless of onboarding status.
 *
 * THE SCAN GATE (Hard Rule 9). A document with no `vault_id` (paper-only) is
 * allowed to exist — freight must move — but it raises WARN immediately and
 * ESCALATED once `scan_due_on` has passed, and it holds the party back from
 * VERIFIED: `can_verify` is false until every REQUIRED, applicable document type
 * has a document that is both scanned (`vault_id`) and `VERIFIED`.
 */
"use strict";

/** Rank a severity so the worst one wins the rolled-up state. RED (the legacy
 *  GL-integrity severity) ranks with ESCALATED. */
const SEVERITY_RANK = { INFO: 0, WARN: 1, RED: 2, ESCALATED: 2, SOFT_BLOCK_RECOMMENDATION: 3, HARD_BLOCK: 4 };
const RANK_STATE = ["OK", "WARN", "ESCALATED", "SOFT_BLOCK_RECOMMENDATION", "HARD_BLOCK"];

const DEFAULT_EXPIRY_WARN_DAYS = 30;

/** The registration statuses (and supplier AVL statuses) that count as "still
 *  onboarding" — a party being set up, not yet trading. */
const ONBOARDING_REG_STATUS = new Set(["DRAFT", "PENDING_REVIEW"]);
const ONBOARDING_AVL_STATUS = new Set(["PROSPECT", "PENDING_KYC"]);

const TIER_RANK = { BASIC: 0, ENHANCED: 1 };
const tierRank = (t) => TIER_RANK[String(t || "BASIC").toUpperCase()] ?? 0;
const upper = (v) => String(v || "").toUpperCase();

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

/** True when a `text[]` scope is empty/absent (⇒ applies to everyone) or
 *  contains `value` (case-insensitively). */
function scopeMatches(scope, value) {
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.map(upper).includes(upper(value));
}

/**
 * Whether a document type applies to this party — role, category, country and
 * KYC tier all considered (PR3 §3.2). `is_required` is checked separately by the
 * caller; this answers "is this type even relevant here".
 */
function docTypeApplies(dt, { appliesTo, category, country, tier } = {}) {
  if (dt.is_active === false) return false;
  if (!appliesToParty(dt, appliesTo)) return false;
  if (!scopeMatches(dt.applies_to_categories, category)) return false;
  if (!scopeMatches(dt.applies_to_countries, country)) return false;
  if (dt.kyc_tier && tierRank(dt.kyc_tier) > tierRank(tier)) return false;
  return true;
}

/** The rolled-up severity rank of a flag set (worst wins). */
function rankOf(flags) {
  let rank = 0;
  for (const f of flags) rank = Math.max(rank, SEVERITY_RANK[f.severity] || 0);
  return rank;
}

/** The rolled-up state: the worst flag severity, mapped to a compliance_state. */
function stateFor(flags) {
  return RANK_STATE[rankOf(flags)];
}

/** Is this party still being onboarded (so onboarding gaps read neutral)? */
function isOnboarding(party = {}) {
  return ONBOARDING_REG_STATUS.has(upper(party.registration_status)) || ONBOARDING_AVL_STATUS.has(upper(party.avl_status));
}

/**
 * The rolled-up state WITH the onboarding rule (PR3 §3.3). If the party is still
 * onboarding and every open flag is an onboarding gap, the state is the neutral
 * ONBOARDING; otherwise it is the ordinary worst-severity rollup.
 */
function stateForParty(flags, party) {
  if (flags.length && isOnboarding(party) && flags.every((f) => f.onboarding)) return "ONBOARDING";
  return stateFor(flags);
}

/**
 * The document types that MUST be present, scanned and verified for this party:
 * required AND applicable. Replaces the old "default_severity === ESCALATED"
 * proxy — required-ness is now its own field (PR3 §3.1).
 */
function requiredTypes(docTypes, ctx) {
  return (docTypes || []).filter((dt) => dt.is_required === true && docTypeApplies(dt, ctx));
}

/** Back-compat alias — "mandatory" now means "required + applicable". */
const mandatoryTypes = (docTypes, appliesTo) => requiredTypes(docTypes, { appliesTo });

/**
 * Whether the party can reach VERIFIED / supplier AVL-APPROVED. False while any
 * required, applicable document type lacks a scanned+verified document, or a
 * screening hit is open. This is the transactional gate the service consults
 * before allowing a verification transition (Hard Rule 9).
 */
function canVerify({ appliesTo, party, documents, docTypes, category, country, tier }) {
  if (party && (party.screen_status === "HIT" || party.screen_status === "SANCTIONS_HIT")) return false;
  const need = requiredTypes(docTypes, { appliesTo, category, country, tier });
  return need.every((dt) =>
    (documents || []).some(
      (d) => d.document_type_id === dt.document_type_id && d.vault_id && d.verification_status === "VERIFIED",
    ),
  );
}

/**
 * Evaluate a party.
 *
 * `category` (its client_type/supplier_type code), `country` (its country_code,
 * or tax residency as a fallback) and `tier` (BASIC/ENHANCED) drive document
 * applicability. Flags carry an `onboarding` marker so the 360 can split
 * "Required to activate" from real "Compliance issues", and so the rolled-up
 * state can stay neutral while a party is still being set up.
 *
 * @returns {{flags: Array<{rule_key,severity,message,onboarding}>, compliance_state: string, can_verify: boolean}}
 */
function evaluate({
  appliesTo, party = {}, documents = [], docTypes = [], banks = [], creditStatus = null,
  category = null, country = null, tier = null, today, expiryWarnDays = DEFAULT_EXPIRY_WARN_DAYS,
}) {
  const t = today ? parseDate(today) || new Date() : new Date();
  const ctx = { appliesTo, category, country: country || party.country_code || party.tax_residency_country, tier: tier || party.kyc_tier };
  const applicable = (docTypes || []).filter((dt) => docTypeApplies(dt, ctx));
  const typeById = new Map(applicable.map((dt) => [dt.document_type_id, dt]));
  const flags = [];

  // Missing REQUIRED documents — only required, applicable types complain; the
  // severity follows the type's default_severity, and the flag is tagged as an
  // onboarding gap (a checklist item, not a failure, until the party is live).
  const present = new Set((documents || []).map((d) => d.document_type_id));
  for (const dt of requiredTypes(docTypes, ctx)) {
    if (!present.has(dt.document_type_id)) {
      flags.push({ rule_key: "party.doc_missing", severity: dt.default_severity || "WARN", message: `Missing ${dt.name || "document"}`, onboarding: true });
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
      // Paper-only: allowed to exist, but WARN now / ESCALATED past the SLA. The
      // pending-scan WARN is an onboarding gap (get it uploaded); an OVERDUE scan
      // is a real failure and escalates regardless of status.
      const du = daysUntil(d.scan_due_on, t);
      if (d.scan_due_on && du !== null && du < 0) {
        flags.push({ rule_key: "party.scan_overdue", severity: "ESCALATED", message: `${name} digital scan overdue` });
      } else {
        flags.push({ rule_key: "party.scan_pending", severity: "WARN", message: `${name} awaiting digital scan`, onboarding: true });
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
  if (party.risk_tier && upper(party.risk_tier) === "HIGH") {
    flags.push({ rule_key: "party.high_risk", severity: "SOFT_BLOCK_RECOMMENDATION", message: "High-risk party — enhanced due diligence" });
  }

  // Data-quality INFO (never affects the state beyond OK).
  if (!party.legal_name) flags.push({ rule_key: "party.missing_legal_name", severity: "INFO", message: "Legal name not set", onboarding: true });

  return {
    flags,
    compliance_state: stateForParty(flags, party),
    can_verify: canVerify({ appliesTo, party, documents, docTypes, category: ctx.category, country: ctx.country, tier: ctx.tier }),
  };
}

module.exports = {
  SEVERITY_RANK,
  RANK_STATE,
  DEFAULT_EXPIRY_WARN_DAYS,
  parseDate,
  daysUntil,
  appliesToParty,
  scopeMatches,
  docTypeApplies,
  isOnboarding,
  stateFor,
  stateForParty,
  requiredTypes,
  mandatoryTypes,
  canVerify,
  evaluate,
};
