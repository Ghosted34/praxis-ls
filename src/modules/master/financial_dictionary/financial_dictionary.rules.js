"use strict";
/**
 * Pure rules for the financial dictionary (MOD-05) — no DB, unit-testable.
 *   - code minting format (#<L><NNN>, letter from direction),
 *   - débours follows direction,
 *   - the nested Basic ⊆ Advanced ⊆ Full tier membership,
 *   - which single service_type_key mirrors a set of tiers,
 *   - the compliance "needs attention" gap.
 */

const LETTER = { REVENUE: "R", EXPENSE: "E", DEBOURS: "D", ASSET: "A" };

/** Code letter for a direction ('X' for an unknown value — never minted). */
function directionLetter(direction) { return LETTER[direction] || "X"; }

/** "#D263" — letter from direction, serial zero-padded to at least 3 digits. */
function formatCode(direction, serial) {
  return `#${directionLetter(direction)}${String(serial).padStart(3, "0")}`;
}

/** A débours item always carries the flag; otherwise the explicit toggle wins. */
function resolveDebours(direction, isDebours) { return direction === "DEBOURS" ? true : !!isDebours; }

const TIER_RANK = { BASIC: 1, ADVANCED: 2, FULL: 3 };
function tierRank(tier) { return TIER_RANK[tier] || 3; }

/**
 * Does an item tagged `itemTier` surface when the service is pulled at
 * `selected` tier? Nested: pulling ADVANCED yields BASIC + ADVANCED lines.
 */
function tierIncludes(selected, itemTier) { return tierRank(itemTier) <= tierRank(selected); }

/**
 * The single legacy service_type_key that mirrors a tier set (kept in step so
 * the Service-Type 360 still reads correctly): first BASIC, else first, else null.
 */
function primaryServiceKey(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const basic = tiers.find((t) => (t.tier || "BASIC") === "BASIC");
  return (basic || tiers[0]).service_key || null;
}

/** A billable item that always needs a receipt but names no proof source. */
function needsAttention(item) {
  return item.receipt_requirement === "ALWAYS_REQUIRED" && !item.proof_source;
}

module.exports = { directionLetter, formatCode, resolveDebours, tierRank, tierIncludes, primaryServiceKey, needsAttention };
