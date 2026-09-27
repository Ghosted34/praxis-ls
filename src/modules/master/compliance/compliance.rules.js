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
 * THREE TIERS, NOT ONE (14030). "Does this tenant want the document on file?"
 * and "must it be on file before the party can be ACTIVATED?" are different
 * questions, and answering both with `is_required` is what put a Bank RIB on
 * every fresh client's activation checklist:
 *
 *   1. `required_for_activation` — THE ACTIVATION SET. A missing one is an
 *      onboarding gap: it IS the "Required to activate" checklist, and it IS
 *      what `canVerify` requires (Hard Rule 9). The only tier that gates.
 *   2. `is_required` (and NOT required_for_activation) — ADVISORY. A missing
 *      one still raises a flag, but it is never `onboarding` (so it never
 *      appears on the activation checklist), never a reason a party cannot be
 *      activated, and never louder than WARN: escalation is reserved for the
 *      activation set and real risk, or an advisory would demand a logged
 *      override on every operation.
 *   3. Neither — tracked if supplied, silent when absent, which is what stops a
 *      brand-new water supplier reading "Escalated — Missing Customs
 *      Authorisation / Missing Power of Attorney".
 *
 * A gap in the first tier keeps the type's own `default_severity`; a gap in the
 * second is capped at WARN (`advisorySeverity`).
 *
 * APPLICABILITY (PR3 §3.2). A type is only considered when it applies to the
 * party's role (`applies_to`), category (`applies_to_categories`), country
 * (`applies_to_countries`), exemption jurisdiction (`exempt_outside_country`,
 * 14030) and KYC tier (`kyc_tier` ≤ party tier). Empty / NULL means "applies to
 * everyone" — except the exemption, which excludes exactly the parties it
 * names (see `docTypeApplies`).
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
 * Whether a jurisdiction EXEMPTION (`exempt_outside_country`, 14030) rules this
 * document type out for a party.
 *
 * The ACF is what a counterparty operating in Cameroon owes; a foreign company
 * operating outside Cameroon owes its own jurisdiction's equivalent instead. A
 * positive country list cannot say that — an empty `applies_to_countries` means
 * "everyone", not "nobody" — so the type names the HOME jurisdiction and every
 * party PROVABLY outside it is exempt.
 *
 * Unknown NEVER exempts: "we do not know where this party is" is not evidence
 * that it does not owe the document, and an exemption that fires on a blank
 * field is how a compliance gate quietly stops gating.
 */
function exemptOutsideCountry(dt, country) {
  const home = upper(dt.exempt_outside_country);
  if (!home) return false;
  if (!country) return false;
  return upper(country) !== home;
}

/**
 * Whether a document type applies to this party — role, category, country,
 * exemption jurisdiction and KYC tier all considered (PR3 §3.2 / 14030).
 * `is_required` / `required_for_activation` are checked separately by the
 * callers; this answers "is this type even relevant here".
 */
function docTypeApplies(dt, { appliesTo, category, country, tier } = {}) {
  if (dt.is_active === false) return false;
  if (!appliesToParty(dt, appliesTo)) return false;
  if (!scopeMatches(dt.applies_to_categories, category)) return false;
  if (!scopeMatches(dt.applies_to_countries, country)) return false;
  if (exemptOutsideCountry(dt, country)) return false;
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
 * The rolled-up state WITH the onboarding rule (PR3 §3.3 / 14030). If the party
 * is still onboarding and every open flag is a gap of the setup kind — an
 * activation gap or an ADVISORY one — the state is the neutral ONBOARDING;
 * otherwise it is the ordinary worst-severity rollup.
 *
 * The advisory class is here deliberately: a document the tenant wants on file
 * but does not gate activation on must not turn a party that is being set up
 * red, and it must not read as a compliance failure either.
 */
function stateForParty(flags, party) {
  if (flags.length && isOnboarding(party) && flags.every((f) => f.onboarding || f.advisory)) return "ONBOARDING";
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

/**
 * THE ACTIVATION SET (14030): the applicable types the tenant requires BEFORE
 * the party can be activated, i.e. `required_for_activation`. This is the set
 * `canVerify` consults and the set the 360 renders as "Required to activate".
 *
 * Deliberately keyed on its own column rather than on `is_required`: a type the
 * tenant merely wants on file raises an advisory flag and gates nothing, which
 * is the rule that stops a Bank RIB holding up a client nobody has billed yet.
 */
function activationTypes(docTypes, ctx) {
  return (docTypes || []).filter((dt) => dt.required_for_activation === true && docTypeApplies(dt, ctx));
}

/** Back-compat alias — "mandatory" now means "required + applicable". */
const mandatoryTypes = (docTypes, appliesTo) => requiredTypes(docTypes, { appliesTo });

/** The severities an ADVISORY (merely `is_required`) gap may carry. Anything
 *  louder — ESCALATED, SOFT_BLOCK_RECOMMENDATION — is reserved for the
 *  activation set and real risk; an advisory that escalates forces a logged
 *  override on every operation, which is the opposite of "advisory". */
const ADVISORY_RANK = { INFO: 0, WARN: 1 };
const advisorySeverity = (severity) => {
  const s = upper(severity);
  return ADVISORY_RANK[s] === undefined ? "WARN" : s;
};

/**
 * Whether the party can reach VERIFIED / supplier AVL-APPROVED. False while any
 * ACTIVATION type lacks a scanned+verified document, or a screening hit is
 * open. This is the transactional gate the service consults before allowing a
 * verification transition (Hard Rule 9).
 */
function canVerify({ appliesTo, party, documents, docTypes, category, country, tier }) {
  if (party && (party.screen_status === "HIT" || party.screen_status === "SANCTIONS_HIT")) return false;
  const need = activationTypes(docTypes, { appliesTo, category, country, tier });
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
 * state can stay neutral while a party is still being set up; a merely-required
 * gap carries `advisory` instead, which keeps it off that checklist.
 *
 * `missingActivationFields` is the FIELD half of the same question (14030):
 * `party_field_config.required_for_activation` rows the party does not fill.
 * It is resolved by the caller (the service owns the DB) and turned into
 * onboarding flags here so the checklist and the activation gate agree.
 *
 * @returns {{flags: Array<{rule_key,severity,message,onboarding}>, compliance_state: string, can_verify: boolean}}
 */
function evaluate({
  appliesTo, party = {}, documents = [], docTypes = [], banks = [], creditStatus = null,
  category = null, country = null, tier = null, today, expiryWarnDays = DEFAULT_EXPIRY_WARN_DAYS,
  missingActivationFields = [],
}) {
  const t = today ? parseDate(today) || new Date() : new Date();
  const ctx = { appliesTo, category, country: country || party.country_code || party.tax_residency_country, tier: tier || party.kyc_tier };
  const applicable = (docTypes || []).filter((dt) => docTypeApplies(dt, ctx));
  const typeById = new Map(applicable.map((dt) => [dt.document_type_id, dt]));
  const flags = [];

  // Missing documents — which BUCKET a gap lands in is the whole point (14030).
  // `required_for_activation` ⇒ an activation requirement: the checklist item,
  //   keeping the type's own severity, and the only thing `canVerify` asks for.
  // merely `is_required` ⇒ advisory: reported, WARN at most, never `onboarding`
  //   (so it never reaches the "Required to activate" list) and never a reason
  //   a party cannot be activated.
  const present = new Set((documents || []).map((d) => d.document_type_id));
  for (const dt of applicable) {
    if (present.has(dt.document_type_id)) continue;
    const activation = dt.required_for_activation === true;
    if (!activation && dt.is_required !== true) continue;
    flags.push({
      rule_key: "party.doc_missing",
      severity: activation ? dt.default_severity || "WARN" : advisorySeverity(dt.default_severity),
      message: `Missing ${dt.name || "document"}`,
      ...(activation ? { onboarding: true } : { advisory: true }),
    });
  }

  // Missing ACTIVATION fields (14030) — tenant config on party_field_config,
  // resolved by the caller. Onboarding gaps: they are what stands between the
  // party and activation, and the activation gate refuses on the same set.
  for (const f of missingActivationFields || []) {
    if (!f) continue;
    flags.push({
      rule_key: "party.field_missing",
      severity: "WARN",
      message: `Missing ${f.label || f.field_key || "field"}`,
      onboarding: true,
    });
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
  exemptOutsideCountry,
  docTypeApplies,
  isOnboarding,
  stateFor,
  stateForParty,
  requiredTypes,
  activationTypes,
  advisorySeverity,
  mandatoryTypes,
  canVerify,
  evaluate,
};
