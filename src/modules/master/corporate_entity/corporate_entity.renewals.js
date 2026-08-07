/**
 * Entity renewals (MOD-01) — pure rules over documents, registrations and tax
 * registrations that expire.
 *
 * This is what makes the module load-bearing rather than a filing cabinet. An
 * expired tax clearance in Cameroon stops you bidding on contracts; nobody is
 * going to remember to check a table.
 *
 * NOTHING HERE HARD-BLOCKS. The severities are INFO, WARN, ESCALATED and
 * SOFT_BLOCK_RECOMMENDATION — a RECOMMENDATION, which a human acts on. HARD_BLOCK
 * is reachable only through an explicit human endpoint, exactly as 0511
 * established for parties ("a rule never writes HARD_BLOCK"). A system that
 * freezes a company's invoicing because a certificate scan is late has made an
 * operational judgement it is not entitled to make.
 *
 * Lead time is per document type, then per document, then a default — a customs
 * bond that takes six weeks to renew has to warn earlier than a licence that
 * takes two days, and that is data, not code.
 */
"use strict";

const DEFAULT_LEAD_DAYS = 60;

/** Escalation ladder as a deadline approaches and passes. */
const SEVERITY_BY_STATE = {
  EXPIRED: "SOFT_BLOCK_RECOMMENDATION",
  DUE: "ESCALATED",
  APPROACHING: "WARN",
  OK: null,
};

/** A `date` column as YYYY-MM-DD. pg hands back a Date; see entity-360.service. */
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Where one expiry sits relative to today.
 *
 * DUE is the inner third of the lead window — close enough that "we will get to
 * it" stops being true. It is deliberately proportional rather than a fixed
 * number of days, so a 90-day lead and a 7-day lead both escalate sensibly.
 */
function stateOf(expiresOn, today, leadDays) {
  if (!expiresOn) return { state: "OK", days_remaining: null };
  const remaining = daysBetween(today, expiresOn);
  if (remaining === null) return { state: "OK", days_remaining: null };
  if (remaining < 0) return { state: "EXPIRED", days_remaining: remaining };
  if (remaining <= Math.max(1, Math.round(leadDays / 3))) return { state: "DUE", days_remaining: remaining };
  if (remaining <= leadDays) return { state: "APPROACHING", days_remaining: remaining };
  return { state: "OK", days_remaining: remaining };
}

/**
 * Lead time for one document: its own override, else its TYPE's, else the
 * default. The repo's join exposes the type's value as `type_renewal_lead_days`
 * so both survive on one row.
 */
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const leadFor = (doc) => num(doc.renewal_lead_days) ?? num(doc.type_renewal_lead_days) ?? DEFAULT_LEAD_DAYS;

/**
 * Everything on this entity that needs renewing, most urgent first.
 *
 * @param {object} input.documents          entity_document rows (joined to their type)
 * @param {object} input.registrations      entity_registration rows
 * @param {object} input.taxRegistrations   entity_tax_registration rows
 * @param {string} [today]                  ISO date; defaults to today
 */
function renewals({ documents = [], registrations = [], taxRegistrations = [] }, today = null) {
  const on = today || new Date().toISOString().slice(0, 10);
  const items = [];

  for (const d of documents) {
    if (d.is_active === false) continue;
    const expires = isoDate(d.expires_on);
    if (!expires) continue;
    const lead = leadFor(d);
    const { state, days_remaining } = stateOf(expires, on, lead);
    if (state === "OK") continue;
    items.push({
      kind: "DOCUMENT",
      id: d.document_id,
      label: d.title || d.document_type_name || d.document_number || "Document",
      type_code: d.document_type_code || null,
      country_code: d.country_code || null,
      expires_on: expires,
      days_remaining,
      state,
      // A document type carries its own severity for being missing/expired
      // (party_document_type.default_severity); it wins over the generic ladder
      // when it is the harsher of the two, so a tax clearance shouts louder than
      // a contract at the same number of days.
      severity: hardest(SEVERITY_BY_STATE[state], state === "EXPIRED" ? d.default_severity : null),
    });
  }

  for (const r of registrations) {
    const expires = isoDate(r.expires_on);
    if (!expires) continue;
    const { state, days_remaining } = stateOf(expires, on, DEFAULT_LEAD_DAYS);
    if (state === "OK") continue;
    items.push({
      kind: "REGISTRATION", id: r.registration_id,
      label: `${r.kind}${r.number ? ` ${r.number}` : ""}`,
      type_code: r.kind, country_code: r.country_code || null,
      expires_on: expires, days_remaining, state, severity: SEVERITY_BY_STATE[state],
    });
  }

  for (const t of taxRegistrations) {
    if (t.is_active === false) continue;
    // A tax registration does not expire, it is deregistered — but a scheduled
    // future deregistration is exactly the kind of thing that should appear on
    // this list, because invoicing has to stop using the number that day.
    const ends = isoDate(t.deregistered_on);
    if (!ends) continue;
    const { state, days_remaining } = stateOf(ends, on, DEFAULT_LEAD_DAYS);
    if (state === "OK") continue;
    items.push({
      kind: "TAX_REGISTRATION", id: t.tax_registration_id,
      label: `${t.tax_kind}${t.tax_number ? ` ${t.tax_number}` : ""}`,
      type_code: t.tax_kind, country_code: t.country_code || null,
      expires_on: ends, days_remaining, state,
      severity: state === "EXPIRED" ? "WARN" : SEVERITY_BY_STATE[state],
    });
  }

  const ORDER = { EXPIRED: 0, DUE: 1, APPROACHING: 2 };
  items.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || ((a.days_remaining ?? 0) - (b.days_remaining ?? 0)));

  return {
    as_of: on,
    items,
    counts: {
      expired: items.filter((i) => i.state === "EXPIRED").length,
      due: items.filter((i) => i.state === "DUE").length,
      approaching: items.filter((i) => i.state === "APPROACHING").length,
    },
  };
}

const RANK = { INFO: 0, WARN: 1, ESCALATED: 2, SOFT_BLOCK_RECOMMENDATION: 3 };
/**
 * The harsher of two severities, never exceeding SOFT_BLOCK_RECOMMENDATION.
 * HARD_BLOCK arriving from data (a mis-seeded document type, say) is clamped
 * rather than honoured — no rule gets to hard-block, whatever it says.
 */
function hardest(a, b) {
  const clamp = (s) => (s && RANK[s] !== undefined ? s : null);
  const x = clamp(a);
  const y = clamp(b);
  if (!x) return y;
  if (!y) return x;
  return RANK[x] >= RANK[y] ? x : y;
}

/**
 * Compliance flags for the shared engine, one per item needing attention.
 *
 * `rule_key` is stable per kind so a flag can be resolved and re-raised across
 * runs without duplicating.
 */
function toComplianceFlags(entityId, result) {
  return result.items
    .filter((i) => i.severity)
    .map((i) => ({
      rule_key: `entity.${i.kind.toLowerCase()}.${i.state.toLowerCase()}`,
      entity_ref: `corporate_entity:${entityId}`,
      severity: i.severity,
      message:
        i.state === "EXPIRED"
          ? `${i.label} expired on ${i.expires_on}.`
          : `${i.label} expires on ${i.expires_on} (${i.days_remaining} days).`,
    }));
}

module.exports = {
  renewals, stateOf, toComplianceFlags, hardest, isoDate, addDays, daysBetween,
  DEFAULT_LEAD_DAYS, SEVERITY_BY_STATE,
};
