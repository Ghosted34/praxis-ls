/**
 * Costing math (MOD-46, KB §6.7) — pure. Disbursements are pass-through:
 * billed at cost, never taxed (assert_line_valid(), 0640, refuses a débours
 * line with a tax code).
 *
 * NO MARGIN HERE (§2.2, owner-approved). Costing answers "what will this cost
 * us?" and stops at HT / VAT / TTC — the legacy costing footer exactly
 * (Subtotal HT / VAT / Total Estimate; api/costing/save.php contains zero
 * margin references, and all 54 'margin' hits in the legacy
 * view costing-module.php files are CSS). Margin is a PRICING question owned by margin_simulation and
 * quotation — which is why the legacy margin simulator has a LINK COSTING
 * dropdown. This module previously computed a sell price from
 * costing.margin_percent, putting margin in two places with nothing keeping
 * them honest; the column is deprecated (kept nullable, never written) and
 * the sell fields are gone.
 */
"use strict";
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);

/**
 * lines → { service_cost, disbursement_total, total_ht, vat_total, total_ttc }.
 *
 * VAT is per line from the line's own tax code rate (`tax_rate_percent`,
 * joined by the repo). A line with no tax code carries no VAT; débours can
 * never carry one (DB rule). Nothing here reads a hardcoded rate.
 */
function computeCosting(lines) {
  let serviceCost = 0;
  let disbursementTotal = 0;
  let serviceVat = 0;
  let debVat = 0;
  for (const l of lines) {
    const amt = num(l.qty) * num(l.unit_cost);
    if (l.is_disbursement) {
      disbursementTotal += amt;
      // 12768: the supplier's VAT on a débours is now BUDGETED — it counts
      // toward the sheet's VAT and TTC. A costing is a cash budget, not a
      // fiscal invoice, so the VAT we hand the carrier is money we will spend,
      // and the budget says so. It is stored as an amount (derived from the
      // line's own rate on save, or typed for the rare bill that is not a clean
      // rate) and the (PT) tag plus a remarks line keep it legible as a
      // pass-through rather than our own output tax.
      debVat += num(l.upstream_vat_amount);
    } else {
      serviceCost += amt;
      serviceVat += amt * (num(l.tax_rate_percent) / 100);
    }
  }
  serviceCost = round2(serviceCost);
  disbursementTotal = round2(disbursementTotal);
  const upstream = round2(debVat);
  const vatTotal = round2(round2(serviceVat) + upstream);
  const totalHt = round2(serviceCost + disbursementTotal);
  return {
    service_cost: serviceCost,
    disbursement_total: disbursementTotal,
    // The legacy footer, by its three names: Subtotal (HT) / VAT / Total Estimate.
    total_ht: totalHt,
    vat_total: vatTotal,
    total_ttc: round2(totalHt + vatTotal),
    // Kept for readers that summed the old shape; same value as total_ht.
    total_cost: totalHt,
    // A MEMO now, not an exclusion (12768): how much of vat_total is the
    // supplier's VAT on débours (PT). It IS inside vat_total — this only names
    // the part, so the sheet and the PDF can show "of which on débours".
    upstream_vat_total: upstream,
  };
}

/**
 * ONE line's TTC — the cash that line commits us to, and therefore the BUDGET a
 * cash request draws down against it (12771).
 *
 * TTC, not HT, and the reason is `computeCosting`'s own: a costing is a cash
 * budget, so the VAT we hand the carrier is money we will spend. A service
 * line's VAT comes from its tax code; a débours carries the supplier's own VAT
 * as a stored amount and can never carry a tax code (the DB refuses one).
 *
 * ROUNDED PER LINE, on purpose. `computeCosting` rounds the VAT of every
 * service line ONCE, at the foot; this rounds each line on its own, because a
 * budget line has to be a stable number that a claim can be compared against
 * and a person can read. On a sheet with many taxed service lines the two can
 * therefore differ by a sub-unit — never more — and the ledger says so rather
 * than pretending the footer and the line set are the same arithmetic.
 *
 * The SQL in `costing.repo.budgetForCosting` computes exactly this expression;
 * the two must not drift.
 */
function lineTtc(l = {}) {
  const net = num(l.qty) * num(l.unit_cost);
  const vat = l.is_disbursement
    ? num(l.upstream_vat_amount)
    : net * (num(l.tax_rate_percent) / 100);
  return round2(net + vat);
}

/**
 * total_ttc expressed in XAF at THIS sheet's own rate.
 *
 * The only figure any cross-costing sum may use. Summing `total_ttc` across
 * sheets adds a USD number to an XAF one, which is what the 360 did before
 * 12766 while the service-type rollup grouped by currency and got a different
 * answer for the same money.
 */
function toXaf(totalTtc, exchangeRateToXaf) {
  const rate = Number(exchangeRateToXaf);
  return round2(num(totalTtc) * (Number.isFinite(rate) && rate > 0 ? rate : 1));
}

/** Budget (costing) vs actual (cost_entry sum) reconciliation for a dossier. */
function reconcile(budgetTotalCost, actualTotal) {
  const b = num(budgetTotalCost);
  const a = num(actualTotal);
  const variance = round2(a - b);
  return { budget: round2(b), actual: round2(a), variance, variance_percent: b ? round2((variance / b) * 100) : null, over_budget: a > b };
}

/**
 * The frozen shape stored in `costing_approval_snapshot.lines`.
 *
 * Deliberately NOT the whole row. A snapshot is read for exactly one purpose —
 * telling a re-approver what moved — so it carries what a person compares
 * (what the charge is, which box it was for, how many, at what price, and
 * whether it was pass-through) and nothing else. Storing the full row would
 * mean every future column silently joins the frozen document and invites
 * someone to read history for a purpose it was never frozen for.
 *
 * Keyed on `dictionary_item_id` + `container_type_ref_id`, because that pair
 * is what makes a line the SAME line across an edit: `costing_line_id` does
 * not survive `replaceLines` (delete + re-insert), so diffing on it would
 * report every line as removed-and-added on every save.
 */
function snapshotLines(lines = []) {
  return lines.map((l) => ({
    key: lineKey(l),
    dictionary_item_id: l.dictionary_item_id || null,
    container_type_ref_id: l.container_type_ref_id || null,
    label: l.label || "",
    qty: num(l.qty),
    unit_cost: num(l.unit_cost),
    is_disbursement: l.is_disbursement === true,
    amount: round2(num(l.qty) * num(l.unit_cost)),
  }));
}

/**
 * The identity of a line across an edit.
 *
 * A charge priced per container type is several lines that share a dictionary
 * item and differ only by box, so both halves are needed: demurrage on a 45'HC
 * and demurrage on a 40'HC are different lines, and neither is "the demurrage
 * line". A free-typed line with no dictionary item falls back to its label,
 * which is the only thing it has — renaming such a line reads as a removal plus
 * an addition, which is honest rather than clever.
 */
function lineKey(l = {}) {
  return [
    l.dictionary_item_id || `label:${String(l.label || "").trim().toLowerCase()}`,
    l.container_type_ref_id || "-",
  ].join("|");
}

/**
 * What changed between the approved snapshot and the sheet as it now stands.
 *
 * The answer to "why is this approved costing open again", rendered for the
 * person being asked to approve it a second time. A demurrage that grew because
 * the box sat three extra days is one changed line among fourteen, and an
 * approver re-reading all fourteen to find it will not find it.
 *
 * Unchanged lines are COUNTED, not listed — the point of the block is that it
 * is short.
 *
 * @param {Array} before snapshot lines (from `snapshotLines`)
 * @param {Array} after  the sheet's current lines
 * @returns {{added, changed, removed, unchanged_count, delta_ht, before_ht, after_ht, has_changes}}
 */
/**
 * Which prior line each payload line IS — the plan an in-place save follows
 * (12771).
 *
 * ── WHY LINE IDENTITY SUDDENLY MATTERS ─────────────────────────────────────
 *
 * `replaceLines` used to delete every line and re-insert, so every
 * `costing_line_id` changed on every DRAFT save. A cash request claims a budget
 * line BY ID, so that link would break at exactly the moment it matters — the
 * amendment. Matching on the logical key `diffLines` already uses means the
 * amendment diff and the budget link agree on what "the same line" is.
 *
 * A QUEUE PER KEY, not a lookup. Two lines can legitimately share one — the
 * same charge priced for a 20' and a 40' box is one item and two container
 * types, but a hand-typed sheet can repeat a label outright — so matches pop in
 * order and a repeat keeps its position instead of being paired arbitrarily.
 *
 * Pure, and it returns a PLAN rather than performing it: the caller decides
 * what columns to write, and the refusal to delete a claimed budget line
 * happens before anything is written.
 *
 * @returns {{writes: Array<{index:number,id:string|null}>, keptIds: string[], dropped: object[]}}
 */
function planLineWrites(prior = [], lines = []) {
  const pool = new Map();
  for (const p of prior) {
    const k = lineKey(p);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(p);
  }
  const writes = [];
  const keptIds = [];
  lines.forEach((l, index) => {
    const queue = pool.get(lineKey(l));
    const match = queue && queue.length ? queue.shift() : null;
    if (match) keptIds.push(match.costing_line_id);
    writes.push({ index, id: match ? match.costing_line_id : null });
  });
  // Whatever the pool still holds is what this save removes.
  return { writes, keptIds, dropped: [...pool.values()].flat() };
}

function diffLines(before = [], after = []) {
  const prior = new Map((before || []).map((l) => [l.key || lineKey(l), l]));
  const now = snapshotLines(after || []);

  const added = [];
  const changed = [];
  let unchangedCount = 0;

  for (const line of now) {
    const was = prior.get(line.key);
    if (!was) {
      added.push({ ...line, delta: line.amount });
      continue;
    }
    prior.delete(line.key);
    const wasAmount = round2(num(was.amount));
    // Quantity and unit cost are compared through the amount they produce: a
    // line re-keyed from 1 × 800,000 to 2 × 400,000 costs the same and is not
    // the change an approver is looking for.
    if (wasAmount !== line.amount) {
      changed.push({
        ...line,
        was_qty: num(was.qty),
        was_unit_cost: num(was.unit_cost),
        was_amount: wasAmount,
        delta: round2(line.amount - wasAmount),
      });
    } else {
      unchangedCount += 1;
    }
  }

  // Whatever the snapshot still holds was on the approved sheet and is not on
  // this one.
  const removed = [...prior.values()].map((l) => ({
    ...l,
    delta: round2(-num(l.amount)),
  }));

  const beforeHt = round2((before || []).reduce((s, l) => s + num(l.amount), 0));
  const afterHt = round2(now.reduce((s, l) => s + l.amount, 0));

  return {
    added,
    changed,
    removed,
    unchanged_count: unchangedCount,
    before_ht: beforeHt,
    after_ht: afterHt,
    delta_ht: round2(afterHt - beforeHt),
    delta_percent: beforeHt ? round2(((afterHt - beforeHt) / beforeHt) * 100) : null,
    has_changes: added.length > 0 || changed.length > 0 || removed.length > 0,
  };
}

/**
 * The lifecycle, in words a person reads.
 *
 * A PAIR, never a pre-joined bilingual string — the transit order's lesson
 * (transit_order.rules.js): a projection that joins the two halves leaves
 * `cfg.language` nothing to decide, so a document configured `fr` prints the
 * English half too. Every label that reaches a template leaves here as
 * {fr, en} and the template picks a side.
 *
 * It lives with the rules rather than with the document because the worksheet
 * and the printed sheet must call the same state the same thing — the legacy
 * costing printed `SUBMITTED_FOR_VALIDATION` on an A4 page.
 */
const STATUS_WORDS = {
  DRAFT: { fr: "Brouillon", en: "Draft" },
  SUBMITTED_FOR_VALIDATION: { fr: "À valider", en: "To validate" },
  SUBMITTED_FOR_APPROVAL: { fr: "À approuver", en: "To approve" },
  APPROVED_LOCKED: { fr: "Approuvée", en: "Approved" },
  UNLOCK_REQUESTED: { fr: "Réouverture demandée", en: "Unlock requested" },
  REJECTED: { fr: "Rejetée", en: "Rejected" },
};
const statusWords = (status) => STATUS_WORDS[String(status || "").toUpperCase()]
  || { fr: String(status || ""), en: String(status || "") };

/**
 * Which pending states can be chased, and what the reminder is asking for
 * (12774). A sheet that is DRAFT, APPROVED_LOCKED or REJECTED has nobody
 * waiting on it, so there is nothing to send and the service refuses.
 */
const NUDGE_STAGE = {
  SUBMITTED_FOR_VALIDATION: "VALIDATION",
  SUBMITTED_FOR_APPROVAL: "APPROVAL",
};

/**
 * How many reminders one costing may send in a day. The owner's instruction,
 * verbatim: *"we can notify just thrice a day. No more! To avoid mounting
 * pressure on CEO."*
 *
 * Here rather than in a setting because it is a restraint the product places on
 * its users, not a preference they tune — a configurable ceiling on nagging is
 * a ceiling that gets raised. Per COSTING per day, not per recipient: a
 * director with ten sheets waiting has ten real decisions and should hear about
 * each; what must not happen is one sheet arriving eleven times.
 */
const NUDGE_DAILY_LIMIT = 3;

/**
 * The budget ledger, derived from the raw rows `costing.repo.budgetForCosting`
 * returns (12771).
 *
 * The SQL does the aggregation — one query rather than fetching every cash
 * request to add them up — and this does the arithmetic a person reads:
 * Remaining, whether a line is over-consumed, and the same four totals for the
 * sheet. Pure, so the identical numbers can be rendered on the worksheet,
 * printed on the voucher and asserted in a test.
 *
 * REMAINING MAY BE NEGATIVE, and that is the point (owner decision Q6). An
 * approved costing line amended DOWN below what has already been committed is
 * legal: the ledger shows the line over-consumed, the reason names the
 * amendment, and the balance is settled in reconciliation. Clamping it at zero
 * would hide exactly the case somebody has to act on.
 */
function summariseBudget(rows = []) {
  const lines = rows.map((r) => {
    const budget = round2(num(r.budget));
    const committed = round2(num(r.committed));
    const remaining = round2(budget - committed);
    return {
      ...r,
      qty: num(r.qty),
      unit_cost: num(r.unit_cost),
      net: round2(num(r.net)),
      vat: round2(num(r.vat)),
      budget,
      committed,
      // Awaiting a decision, so it consumes nothing — it is here so a validator
      // can see that headroom is already spoken for before adding to the queue.
      pending: round2(num(r.pending)),
      // Apportioned: instalments are paid against the request, not its lines.
      disbursed: round2(num(r.disbursed)),
      remaining,
      over_committed: remaining < 0,
    };
  });
  const sum = (k) => round2(lines.reduce((s, l) => s + l[k], 0));
  return {
    lines,
    totals: {
      budget: sum("budget"),
      committed: sum("committed"),
      pending: sum("pending"),
      disbursed: sum("disbursed"),
      remaining: sum("remaining"),
      over_committed_lines: lines.filter((l) => l.over_committed).length,
    },
  };
}

module.exports = {
  computeCosting, lineTtc, summariseBudget, reconcile, toXaf,
  snapshotLines, diffLines, lineKey, planLineWrites, statusWords,
  NUDGE_STAGE, NUDGE_DAILY_LIMIT,
};
