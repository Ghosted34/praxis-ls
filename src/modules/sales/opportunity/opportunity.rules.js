/**
 * Opportunity / sales pipeline (MOD-24) — pure rules. No SQL, no client.
 *
 * F7 (doc/SALES_CRM_FEATURES.md#F7). Three things live here because all three
 * are arithmetic somebody will want to check by hand against a spreadsheet, and
 * arithmetic buried in a SQL string cannot be checked by hand.
 *
 * ── 1. THE SEVEN STAGES ─────────────────────────────────────────────────────
 * The legacy permits seven (api/sales_pipeline/_common.php line 26); this repo
 * seeded six. The missing one, PRICING_IN_PROGRESS, is the handoff from sales
 * to commercial pricing — "with the margin simulator" — and carries 50%.
 *
 * This list is the SHIPPED DEFAULT, not the enforced set. `pipeline_stage` is
 * tenant-tunable (BUILD_CONVENTIONS §6): a tenant may rename, reorder, add or
 * retire stages, and nothing in the service reads the codes below. They exist
 * so the migration, the tests and a reader can agree on what "seven stages"
 * means without opening a database.
 *
 * ── 2. PROBABILITY DERIVATION ───────────────────────────────────────────────
 * A stage carries a probability; a deal in that stage inherits it. But a
 * salesperson who has typed a number on a deal they know is soft must not have
 * it silently reset by the next stage move — so `probability_is_manual` records
 * which of the two owns the value, and `deriveProbability` is the one place
 * that decides.
 *
 * ── 3. WIN RATE ─────────────────────────────────────────────────────────────
 * The one figure the legacy and this system compute differently, so both are
 * returned, both are named, and neither is presented as "the" win rate. See
 * `winRate` for why that is not fence-sitting.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

/**
 * The default stage ladder. Order is the board's left-to-right order;
 * `probability` is the seeded `pipeline_stage.default_probability`.
 */
const DEFAULT_STAGES = [
  { code: "NEW", name: "New", sort_order: 0, probability: 10, is_won: false, is_lost: false },
  { code: "QUALIFIED", name: "Qualified", sort_order: 1, probability: 30, is_won: false, is_lost: false },
  { code: "PRICING_IN_PROGRESS", name: "Pricing", sort_order: 2, probability: 50, is_won: false, is_lost: false },
  { code: "PROPOSAL", name: "Proposal sent", sort_order: 3, probability: 70, is_won: false, is_lost: false },
  { code: "NEGOTIATION", name: "Negotiation", sort_order: 4, probability: 85, is_won: false, is_lost: false },
  { code: "WON", name: "Won", sort_order: 5, probability: 100, is_won: true, is_lost: false },
  { code: "LOST", name: "Lost", sort_order: 6, probability: 0, is_won: false, is_lost: true },
];

/** Where an opportunity may have come from — the 0683 intake vocabulary + in-system origins. */
const SOURCES = [
  "WEBSITE",
  "MANUAL",
  "REFERRAL",
  "CAMPAIGN",
  "QUOTE_REQUEST",
  "LEAD_CONVERSION",
  "PARTNER",
  "OTHER",
];

const STATUSES = ["OPEN", "WON", "LOST"];

/**
 * A settled opportunity is frozen. The legacy accepts ANY status by POST with
 * no guard (api/sales_pipeline/update.php) — that is the regression this
 * refuses to port. Kept here rather than inline in the service so the rule is
 * stated once and tested without a database.
 */
function assertOpen(opp, what = "change") {
  if (!opp) throw new AppError("NOT_FOUND", "Opportunity not found", 404);
  if (opp.status !== "OPEN") {
    throw new AppError("LOCKED", `A settled opportunity cannot ${what}`, 422);
  }
  return true;
}

/**
 * The probability an opportunity should carry after landing in `stage`.
 *
 *   - `explicit` (a number the caller just typed) always wins, and marks the
 *     value manual from here on.
 *   - a value the user marked manual earlier is left alone.
 *   - otherwise the stage's default applies. A stage with no default leaves the
 *     existing value untouched rather than nulling it — an unconfigured stage
 *     should not erase data.
 *
 * Returns `{ probability, probability_is_manual }`, or `null` when nothing
 * should change (so the caller writes no column at all).
 */
function deriveProbability({ stage = null, current = null, isManual = false, explicit = undefined } = {}) {
  if (explicit !== undefined && explicit !== null) {
    return { probability: explicit, probability_is_manual: true };
  }
  if (isManual) return null;

  const fromStage = stage && stage.default_probability !== null && stage.default_probability !== undefined
    ? Number(stage.default_probability)
    : null;
  if (fromStage === null) return null;
  if (current !== null && current !== undefined && Number(current) === fromStage) return null;
  return { probability: fromStage, probability_is_manual: false };
}

/**
 * Weighted value of one deal — value × probability. The forecast column on the
 * board is the sum of this, and it is the same expression in SQL; having it
 * here too is what lets a test assert the two agree.
 */
function weighted(value, probability) {
  const v = Number(value) || 0;
  const p = Number(probability) || 0;
  return Math.round(((v * p) / 100) * 100) / 100;
}

/**
 * BOTH win rates, named.
 *
 * `settled` = won / (won + lost). Deals that have actually been decided. This
 * is the headline: it does not sag merely because intake is busy, so a month
 * with a full pipeline and a good close record reads as a good month.
 *
 * `all_deals` = won / (won + lost + open). What the legacy's kpis.php computes
 * (won / every converted row). It is not wrong — it answers "of everything we
 * have ever touched, how much did we win" — but it moves when nothing about
 * closing performance has moved, which is why it is not the headline.
 *
 * Both are returned because a report that says "win rate: 62%" and a report
 * that says "win rate: 31%" about the same data, three weeks apart, is how
 * people stop trusting a dashboard. Naming both removes the guess.
 *
 * A denominator of zero returns null, never 0 — "no deals settled yet" and
 * "settled deals, none won" are different facts and a tile showing 0% for the
 * first one is a lie.
 */
function winRate({ won = 0, lost = 0, open = 0 } = {}) {
  const w = Number(won) || 0;
  const l = Number(lost) || 0;
  const o = Number(open) || 0;
  const settledN = w + l;
  const allN = w + l + o;
  return {
    won: w,
    lost: l,
    open: o,
    settled_count: settledN,
    settled: settledN > 0 ? Math.round((w / settledN) * 100) : null,
    all_deals: allN > 0 ? Math.round((w / allN) * 100) : null,
  };
}

module.exports = {
  DEFAULT_STAGES,
  SOURCES,
  STATUSES,
  assertOpen,
  deriveProbability,
  weighted,
  winRate,
};
