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

module.exports = { computeCosting, reconcile, toXaf, snapshotLines, diffLines, lineKey, statusWords };
