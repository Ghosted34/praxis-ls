/**
 * Budget Reconciliation — pure rules (MOD-76). No I/O.
 *
 * Every number a screen, a PDF and a test can disagree about lives here once.
 *
 * ── TTC, AND WHY THERE IS ONE HT FIGURE ─────────────────────────────────────
 *
 * The grid is TTC end to end (owner decision Q4). The question this module
 * answers is a CASH question — "we disbursed 119 250, is that what you spent?"
 * — and cash includes the VAT we handed the carrier. 12768 settled the same
 * point for the costing: "a costing is a cash budget, not a fiscal invoice".
 *
 * The MARGIN question is a fiscal question and is HT with débours excluded
 * (OHADA_KB §450), and `pricing_variance` still reads it. So exactly one HT
 * figure is derived here, at the header, from the line's own tax treatment —
 * never stored, never a second column, and labelled on screen as the indicator
 * it is. It is exact when the supplier charged the rate the costing assumed and
 * approximate otherwise; the TTC number is the one that is exact, and it is the
 * one that closes the file.
 */
"use strict";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

/** Tenant defaults for the overspend allowance (Q13). Owner-accepted: 1 000 and
 *  2%, BOTH of which must be exceeded before a reason is demanded. */
const DEFAULT_ALLOWANCE = { amount: 1000, percent: 2 };

function allowanceFrom(setting = {}) {
  const amount = Number(setting.overspend_allowance_amount);
  const percent = Number(setting.overspend_allowance_percent);
  return {
    amount: Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_ALLOWANCE.amount,
    percent: Number.isFinite(percent) && percent >= 0 ? percent : DEFAULT_ALLOWANCE.percent,
  };
}

/**
 * Does this line's overspend need explaining?
 *
 * BOTH thresholds must be exceeded, and that is the point. 2% of a 2 500 000
 * customs line is 50 000 and must be explained; 2% of a 5 000 line is 100 and
 * must not. A percentage alone nags on small lines, an absolute alone waves
 * through six figures on a large one.
 *
 * A line with no budget at all cannot be judged by a percentage, so the
 * absolute floor decides it on its own — the honest reading of "we spent money
 * against a line worth nothing", which is the largest overrun there is.
 */
function reasonRequired(line, allowance = DEFAULT_ALLOWANCE) {
  const budget = num(line.budget_ttc);
  const overspend = round2(num(line.actual_ttc) - budget);
  if (overspend <= 0) return false;
  if (overspend <= num(allowance.amount)) return false;
  if (budget <= 0) return true;
  return overspend > budget * (num(allowance.percent) / 100);
}

/**
 * One grid row, as the screen and the statement read it.
 *
 * PRE-FILL (Q2 = C, owner answer). Pre-fill from what the system knows, and
 * once postings exist that is `posted_ttc` (what the LEDGER holds for this
 * line) rather than `disbursed` (what cash went out the door). Before the first
 * settlement, nothing writes cost_entry.costing_line_id, so posted is zero and
 * pre-fill falls back to disbursed — which is exactly the hypothesis worth
 * putting in front of a person: "119 250 was disbursed — is that what you
 * spent?". The owner's sentence, unchanged.
 *
 * HT/TTC (Q4). Posted is stored HT (cost_entry.amount); the grid is TTC end to
 * end. The join grosses HT up using the line's own VAT ratio so both bases
 * never meet in one column.
 *
 * A stored row exists — so a stored ZERO is a real answer, not an absent one,
 * and must not fall back to the pre-fill.
 *
 * A line that was budgeted and never funded AND never posted pre-fills 0, not
 * its budget: it is unused budget, not a saving anybody achieved (Q14).
 */
function lineView(row, allowance = DEFAULT_ALLOWANCE) {
  const budget = round2(num(row.budget_ttc));
  const committed = round2(num(row.committed));
  const disbursed = round2(num(row.disbursed));
  const postedTtc = round2(num(row.posted_ttc));
  const touched = row.line_id !== null && row.line_id !== undefined;
  const prefill = postedTtc > 0 ? postedTtc : disbursed;
  const actual = touched ? round2(num(row.actual_ttc)) : prefill;
  const returned = round2(num(row.returned_amount));
  // Computed BEFORE the object literal rather than assigned onto it after.
  // Mutating a returned view hides the fields from every static reader — the
  // response-contract gate among them, which scans object-literal keys to know
  // what the server actually emits. A field the client types and the scanner
  // cannot see is exactly the shape of the revoked_at/killed_at bug.
  const variance = round2(budget - actual);
  const overBudget = variance < 0;
  const reasonRequired_ = reasonRequired({ budget_ttc: budget, actual_ttc: actual }, allowance);
  const justificationRequired = row.justification_required === true;
  const documentCount = Number(row.document_count) || 0;

  return {
    costing_line_id: row.costing_line_id,
    line_id: row.line_id || null,
    line_no: row.line_no,
    label: row.label,
    item_code: row.item_code || null,
    item_label: row.item_label || null,
    container_type_code: row.container_type_code || null,
    dictionary_item_id: row.dictionary_item_id || null,
    is_disbursement: row.is_disbursement === true,
    qty: num(row.qty),
    unit_cost: round2(num(row.unit_cost)),
    net: round2(num(row.net)),
    vat: round2(num(row.vat)),
    budget_ttc: budget,
    committed,
    pending: round2(num(row.pending)),
    disbursed,
    posted_ht: round2(num(row.posted_ht)),
    posted_ttc: postedTtc,
    actual_ttc: actual,
    actual_source: touched ? row.actual_source : "DERIVED",
    spent_on: row.spent_on || null,
    // Positive = under budget, which is the direction a reader expects "good"
    // to point. Negative is the overspend that has to be explained.
    variance,
    variance_reason: row.variance_reason || null,
    reason_group_id: row.reason_group_id || null,
    returned_amount: returned,
    // What the person who took the cash still has to account for. Disbursed
    // money that is neither evidenced as spent nor handed back.
    outstanding: round2(disbursed - actual - returned),
    justification_required: justificationRequired,
    document_count: documentCount,
    funded: disbursed > 0,
    over_budget: overBudget,
    reason_required: reasonRequired_,
    reason_missing: reasonRequired_ && !row.variance_reason,
    // A line owes a receipt when somebody ticked it, money was actually spent,
    // and nothing has been attached. `actual > 0` matters: a budgeted line that
    // was never spent owes no paperwork — the legacy had the same condition and
    // it was the one part of its gate that was right.
    proof_missing: justificationRequired && actual > 0 && documentCount === 0,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
  };
}

/**
 * The HT margin indicator (§4.5 of the guide).
 *
 * Strips each service line's own VAT off its TTC actual and drops débours
 * entirely, because débours are neither revenue nor cost to the forwarder.
 * Derived, never stored.
 */
function actualHt(lines = []) {
  let total = 0;
  for (const l of lines) {
    if (l.is_disbursement) continue;
    const net = num(l.net);
    const vat = num(l.vat);
    // The line's own VAT ratio, taken from the BUDGET's shape: net 100 000 +
    // VAT 19 250 means an actual of 119 250 is 100 000 HT. A zero-net line
    // cannot imply a rate, so its actual is read as HT already.
    const ratio = net > 0 ? net / (net + vat) : 1;
    total += num(l.actual_ttc) * ratio;
  }
  return round2(total);
}

/**
 * The footer, the KPI strip and the three grades.
 *
 * THREE grades rather than one (Q17), because they come apart in a case that
 * happens: a file executed beautifully against a budget that was quoted too
 * cheap is EFFICIENT and RED at once, and showing one number would tell either
 * the operations lead or the commercial lead something untrue.
 *
 *   execution     budget vs actual   — did we spend what we planned?
 *   accountability disbursed vs (actual + returned) — is all the cash accounted for?
 *   commercial    quoted vs actual HT — did the file make money? (null with no quote)
 */
function summarise(lines = [], { quotedHt = null } = {}) {
  const sum = (k) => round2(lines.reduce((s, l) => s + num(l[k]), 0));
  const totals = {
    budget_ttc: sum("budget_ttc"),
    committed: sum("committed"),
    disbursed: sum("disbursed"),
    actual_ttc: sum("actual_ttc"),
    returned: sum("returned_amount"),
    outstanding: sum("outstanding"),
    lines: lines.length,
    lines_over_budget: lines.filter((l) => l.over_budget).length,
    reasons_missing: lines.filter((l) => l.reason_missing).length,
    proofs_missing: lines.filter((l) => l.proof_missing).length,
    // Service-only HT, débours excluded — the one fiscal number (§4.5).
    actual_ht: actualHt(lines),
    // Assigned in the literal for the same reason lineView's flags are: a field
    // the client types and no static reader can see is invisible drift.
    variance: round2(sum("budget_ttc") - sum("actual_ttc")),
    margin_ht:
      quotedHt === null || quotedHt === undefined
        ? null
        : round2(num(quotedHt) - actualHt(lines)),
  };

  const anyActual = lines.some((l) => l.actual_source !== "DERIVED");
  return {
    totals,
    grades: {
      execution: !anyActual
        ? { key: "PENDING", label: "Awaiting inputs", percent: null }
        : totals.variance >= 0
          ? { key: "WITHIN_BUDGET", label: "Within budget", percent: pct(totals.variance, totals.budget_ttc) }
          : { key: "OVER_BUDGET", label: "Over budget", percent: pct(-totals.variance, totals.budget_ttc) },
      accountability: totals.outstanding > 0
        ? { key: "OUTSTANDING", label: "Cash to account for", amount: totals.outstanding }
        : { key: "ACCOUNTED", label: "Fully accounted for", amount: 0 },
      commercial: totals.margin_ht === null
        ? { key: "NO_QUOTE", label: "No accepted quotation", percent: null }
        : totals.margin_ht >= 0
          ? { key: "PROFITABLE", label: "Margin earned", percent: pct(totals.margin_ht, quotedHt) }
          : { key: "LOSS", label: "Below quoted price", percent: pct(-totals.margin_ht, quotedHt) },
    },
  };
}

/** Percent of a base, or null when the base is zero — 0% would read as "none of
 *  it" when the true answer is "there is nothing to be a percentage of". */
function pct(value, base) {
  const b = num(base);
  if (b <= 0) return null;
  return Math.round((num(value) / b) * 1000) / 10;
}

/**
 * Everything standing between this sheet and submission, in ONE list.
 *
 * Deliberately not two checks: a user who is missing three receipts and two
 * reasons should be told that once, not handed a 422 five times in a row. The
 * caller turns this into a single error whose detail names every line.
 */
function submissionBlockers(lines = []) {
  const blockers = [];
  for (const l of lines) {
    if (l.reason_missing) {
      blockers.push({
        costing_line_id: l.costing_line_id,
        label: l.label,
        kind: "REASON",
        detail: `over budget by ${round2(-l.variance)}`,
      });
    }
    if (l.proof_missing) {
      blockers.push({
        costing_line_id: l.costing_line_id,
        label: l.label,
        kind: "PROOF",
        detail: "needs a supporting document",
      });
    }
  }
  return blockers;
}

module.exports = {
  DEFAULT_ALLOWANCE, allowanceFrom, reasonRequired,
  lineView, summarise, submissionBlockers, actualHt, pct, round2,
};
