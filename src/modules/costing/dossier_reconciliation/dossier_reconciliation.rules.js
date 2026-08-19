/**
 * OCR reconciliation — pure rules (§2.1).
 *
 * Two jobs, no I/O:
 *
 * 1. THE THREE QUESTIONS. The merged screen answers, in sequence: did we quote
 *    it right (quoted − budget), did we execute to plan (budget − actual), did
 *    we make money (quoted − actual). All HT, service costs only — débours are
 *    pass-through and live in a separate total (OHADA_KB §450).
 *
 * 2. THE MATCHER. Actuals arrive pre-filled with what can be PROVEN: a
 *    cost_entry that names its dictionary_item_id. Entries that name no item
 *    are scored here against the items on the approved costing, and the best
 *    plausible mapping is PROPOSED for a human to confirm — the assistant may
 *    propose, never confirm (same rule as MOD-09 bank reconciliation,
 *    reconciliation.ai.js).
 */
"use strict";

const { computeVariance, flagFor } = require("../../commercial/pricing_variance/pricing_variance.rules");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Header variance block from the three header figures. `quoted_ht` may be
 * null (file won without an accepted quotation) — then only the execution
 * question (budget vs actual) is answerable and the flag is null rather than
 * a fake RED.
 */
function computeVarianceBlock({ quoted_ht = null, budget_ht = 0, actual_ht = 0 }, thresholds = {}) {
  const budget = Number(budget_ht) || 0;
  const actual = Number(actual_ht) || 0;
  const hasQuote = quoted_ht !== null && quoted_ht !== undefined;
  const quoted = hasQuote ? Number(quoted_ht) || 0 : null;
  const out = {
    quoted_ht: hasQuote ? round2(quoted) : null,
    budget_ht: round2(budget),
    actual_ht: round2(actual),
    // Q2 — did we execute to plan? Positive = under budget.
    budget_vs_actual: round2(budget - actual),
    quote_vs_budget: null,
    quote_vs_actual: null,
    margin_percent: null,
    flag: null,
  };
  if (hasQuote) {
    // Q1 — did we quote it right? Positive = quoted above planned cost.
    out.quote_vs_budget = round2(quoted - budget);
    // Q3 — did we make money? Positive = margin earned.
    out.quote_vs_actual = round2(quoted - actual);
    const { margin_percent } = computeVariance({ quotedPrice: quoted, actualCost: actual });
    out.margin_percent = margin_percent;
    out.flag = flagFor(margin_percent, thresholds);
  }
  return out;
}

/** Lowercase, strip accents and punctuation, split to tokens. "Frais de Douane"
 *  and "DOUANE_IMPORT" must meet in the middle. */
function tokens(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2); // 'de', 'du', 'of' carry no signal
}

/** Overlap ratio of entry tokens found in the item's code+labels (0..1). */
function nameScore(entryText, item) {
  const et = tokens(entryText);
  if (!et.length) return 0;
  const it = new Set([...tokens(item.item_code), ...tokens(item.item_label)]);
  if (!it.size) return 0;
  let hit = 0;
  for (const t of et) if (it.has(t)) hit += 1;
  return hit / et.length;
}

/** How close the entry amount is to the item's remaining budget (0..1).
 *  remaining <= 0 (already fully spent) scores 0 — the money probably belongs
 *  elsewhere. */
function amountScore(amount, item) {
  const remaining = (Number(item.budget_ht) || 0) - (Number(item.actual_ht) || 0);
  const a = Math.abs(Number(amount) || 0);
  if (remaining <= 0 || a === 0) return 0;
  const diff = Math.abs(a - remaining);
  return Math.max(0, 1 - diff / Math.max(a, remaining));
}

/** Below this the proposal is noise — the human would be confirming a guess,
 *  which defeats the point of proposing. */
const MIN_CONFIDENCE = 0.45;

/**
 * Rank one untagged entry against the costed items. Returns the best
 * candidate `{ dictionary_item_id, confidence, reason }` or null when nothing
 * clears MIN_CONFIDENCE. Name similarity dominates (an amount can coincide;
 * a name rarely does); amount proximity breaks ties.
 */
function proposeMapping(entry, items) {
  let best = null;
  for (const item of items) {
    if (!item.dictionary_item_id) continue;
    const name = nameScore(entry.category, item);
    const amt = amountScore(entry.amount, item);
    const confidence = Math.round((0.7 * name + 0.3 * amt) * 10000) / 10000;
    if (confidence >= MIN_CONFIDENCE && (!best || confidence > best.confidence)) {
      const parts = [];
      if (name > 0) parts.push(`label "${String(entry.category || "").trim()}" matches ${item.item_code}`);
      if (amt > 0.5) parts.push(`amount ${round2(entry.amount)} ≈ remaining budget ${round2((item.budget_ht || 0) - (item.actual_ht || 0))}`);
      best = {
        dictionary_item_id: item.dictionary_item_id,
        confidence,
        reason: parts.join("; ") || "closest costed item",
      };
    }
  }
  return best;
}

module.exports = { computeVarianceBlock, proposeMapping, tokens, nameScore, amountScore, MIN_CONFIDENCE };
