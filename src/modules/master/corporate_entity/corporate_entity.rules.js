/**
 * Corporate entity (MOD-01) — pure rules. No SQL, no I/O; the service supplies
 * the rows and decides what to do with the verdicts.
 *
 * Two of these are deliberately ADVISORY rather than throwing: cap-table
 * reconciliation and the letterhead-readiness check. A partly-recorded cap table
 * is the normal state during onboarding, and a hard failure there would stop
 * people saving the very data the module exists to collect. They return findings;
 * the API surfaces them and the operator decides.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const LIFECYCLE = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "DEACTIVATED", "ARCHIVED"];

/**
 * Legal lifecycle transitions.
 *
 * ARCHIVED is terminal: an entity with ledger history can never be deleted, and
 * "archived then quietly reactivated" is how a dormant company's books get mixed
 * into a live period. Reaching it again requires a deliberate DEACTIVATED hop,
 * which is auditable.
 */
// DRAFT and PENDING_REVIEW can reach DEACTIVATED ("abandon this draft") so that
// the legacy POST /entities/:id/active route, which maps false -> DEACTIVATED
// from whatever state it finds, stays total. Without it, deactivating a draft
// entity would 409 on a route that has always accepted it.
const TRANSITIONS = {
  DRAFT: ["PENDING_REVIEW", "ACTIVE", "DEACTIVATED", "ARCHIVED"],
  PENDING_REVIEW: ["ACTIVE", "DRAFT", "DEACTIVATED", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "DEACTIVATED"],
  SUSPENDED: ["ACTIVE", "DEACTIVATED"],
  DEACTIVATED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

function assertTransition(from, to) {
  if (!LIFECYCLE.includes(to)) throw new AppError("BAD_STATUS", `"${to}" is not a valid entity status`, 422);
  const current = from || "ACTIVE";
  if (current === to) return true;
  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(to)) {
    throw new AppError(
      "BAD_TRANSITION",
      `An entity cannot go from ${current} to ${to}.` +
        (allowed.length ? ` From ${current} the options are: ${allowed.join(", ")}.` : " That status is final."),
      409,
    );
  }
  return true;
}

/** Deactivating or archiving needs a reason — it is the audit trail's whole point. */
function assertReasonFor(status, reason) {
  if (["SUSPENDED", "DEACTIVATED", "ARCHIVED"].includes(status) && !String(reason || "").trim()) {
    throw new AppError("REASON_REQUIRED", `Give a reason when moving an entity to ${status}.`, 422);
  }
  return true;
}

/** Fiscal year start is 1-12. Kept here so create and update cannot disagree. */
function assertFiscalMonth(m) {
  if (m === undefined || m === null) return true;
  const n = Number(m);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new AppError("BAD_MONTH", "fiscal_year_start_month must be 1-12", 422);
  }
  return true;
}

/**
 * Group-structure cycle check.
 *
 * A → B → A is not a hierarchy, and once it exists any recursive walk over the
 * group (consolidation, the Structure tab, the entity picker's tree) either
 * infinite-loops or silently truncates. The database CHECK only catches the
 * one-hop case (an entity as its own parent), so the multi-hop walk lives here.
 *
 * @param {string} entityId       the entity being re-parented
 * @param {string|null} parentId  its proposed new parent
 * @param {Map<string,string|null>} parentOf  entity_id -> parent_entity_id, whole tenant
 */
function assertNoCycle(entityId, parentId, parentOf) {
  if (!parentId) return true;
  if (String(parentId) === String(entityId)) {
    throw new AppError("CYCLIC_PARENT", "An entity cannot be its own parent.", 422);
  }
  const seen = new Set([String(entityId)]);
  let cursor = String(parentId);
  // Bounded by the map's size: every hop consumes one distinct entity, so a walk
  // longer than the tenant's entity count means a cycle regardless of shape.
  while (cursor) {
    if (seen.has(cursor)) {
      throw new AppError(
        "CYCLIC_PARENT",
        "That parent would create a loop in the group structure.",
        422,
      );
    }
    seen.add(cursor);
    cursor = parentOf.get(cursor) ? String(parentOf.get(cursor)) : null;
  }
  return true;
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Reconcile a cap table. ADVISORY — returns findings, never throws.
 *
 * Three things can be wrong and they are genuinely different:
 *   - holdings do not sum to 100% (incomplete, or double-counted);
 *   - share counts and stated percentages disagree (someone edited one);
 *   - the sum of share_count × nominal_value does not match share_capital.
 *
 * Only CURRENT holdings count — a row with `effective_to` in the past is a
 * historical position and including it would make every past transfer look like
 * an over-allocation.
 *
 * @param {object[]} people   entity_person rows
 * @param {object} entity     the corporate_entity row (for share_capital)
 * @param {string} [asOf]     ISO date; defaults to today
 */
function reconcileCapTable(people, entity, asOf = null) {
  // `entity = {}` as a parameter default would NOT cover an explicit null — a JS
  // default only fires on undefined — and a null entity is reachable from the AI
  // tool and from any caller that passes a lookup result straight through.
  const e = entity || {};
  const on = asOf || new Date().toISOString().slice(0, 10);
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

  const holders = (people || []).filter((p) => {
    if (p.role !== "SHAREHOLDER") return false;
    const from = iso(p.effective_from);
    const to = iso(p.effective_to);
    if (from && from > on) return false;
    if (to && to < on) return false;
    return true;
  });

  const findings = [];
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

  const percents = holders.map((h) => num(h.ownership_percent)).filter((n) => n !== null && Number.isFinite(n));
  const totalPercent = round4(percents.reduce((a, b) => a + b, 0));

  const counts = holders.map((h) => num(h.share_count)).filter((n) => n !== null && Number.isFinite(n));
  const totalShares = round4(counts.reduce((a, b) => a + b, 0));

  if (holders.length && percents.length) {
    if (totalPercent > 100.0001) {
      findings.push({ code: "OVER_ALLOCATED", severity: "WARN", message: `Shareholdings total ${totalPercent}%, which is more than 100%.` });
    } else if (totalPercent < 99.9999) {
      findings.push({ code: "UNDER_ALLOCATED", severity: "INFO", message: `Shareholdings total ${totalPercent}%. ${round4(100 - totalPercent)}% is unaccounted for.` });
    }
  }

  // Percentages implied by share counts, compared against what was typed. A
  // tolerance of 0.01pp absorbs rounding on thirds (33.33/33.33/33.34).
  if (totalShares > 0) {
    for (const h of holders) {
      const c = num(h.share_count);
      const p = num(h.ownership_percent);
      if (c === null || p === null) continue;
      const implied = round4((c / totalShares) * 100);
      if (Math.abs(implied - p) > 0.01) {
        findings.push({
          code: "PERCENT_MISMATCH", severity: "WARN", person_id: h.person_id,
          message: `${h.full_name} holds ${c} of ${totalShares} shares (${implied}%) but is recorded at ${p}%.`,
        });
      }
    }
  }

  // Issued capital vs stated share capital.
  const capital = num(e.share_capital);
  const issued = holders.reduce((sum, h) => {
    const c = num(h.share_count);
    const nominal = num(h.share_nominal_value);
    return c !== null && nominal !== null ? sum + c * nominal : sum;
  }, 0);
  if (capital !== null && capital > 0 && issued > 0 && Math.abs(issued - capital) > 0.01) {
    findings.push({
      code: "CAPITAL_MISMATCH", severity: "WARN",
      message: `Issued shares are worth ${round4(issued)} but share capital is recorded as ${capital}.`,
    });
  }

  return {
    as_of: on,
    holder_count: holders.length,
    total_percent: totalPercent,
    total_shares: totalShares,
    issued_capital: round4(issued),
    balanced: findings.filter((f) => f.severity === "WARN").length === 0,
    findings,
  };
}

/**
 * What is still missing before this entity can print a compliant letterhead or be
 * moved to ACTIVE. ADVISORY — the API returns it, the dossier renders it as a
 * checklist, and nothing blocks on it.
 *
 * `PENDING_REVIEW → ACTIVE` deliberately does NOT enforce this: whether an entity
 * is trading is a fact about the world, not something the system gets to veto
 * because a field is blank.
 */
function readiness(entity, children) {
  // Same null-vs-undefined trap as reconcileCapTable, with a sharper edge:
  // destructuring an explicit null in the signature throws outright rather than
  // falling back to the default.
  const e = entity || {};
  const { registrations = [], addresses = [], people = [] } = children || {};
  const missing = [];
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

  if (!has(e.legal_name)) missing.push({ field: "legal_name", label: "Legal name" });
  if (!has(e.legal_form)) missing.push({ field: "legal_form", label: "Legal form" });
  if (!has(e.incorporation_date)) missing.push({ field: "incorporation_date", label: "Date of incorporation" });
  if (!has(e.share_capital)) missing.push({ field: "share_capital", label: "Share capital" });
  if (!has(e.email) && !has(e.phone)) missing.push({ field: "contact", label: "A public email or phone" });
  if (!registrations.length) missing.push({ field: "registrations", label: "At least one tax/trade registration" });
  if (!addresses.some((a) => a.type === "REGISTERED")) missing.push({ field: "address", label: "A registered office address" });
  if (!people.some((p) => ["DIRECTOR", "LEGAL_REPRESENTATIVE"].includes(p.role))) {
    missing.push({ field: "people", label: "A director or legal representative" });
  }

  return { ready: missing.length === 0, missing };
}

module.exports = {
  LIFECYCLE, TRANSITIONS,
  assertTransition, assertReasonFor, assertFiscalMonth, assertNoCycle,
  reconcileCapTable, readiness,
};
