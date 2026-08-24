/**
 * AI Governance (AII control) — pure rules, DB-free (KB / AI_ARCHITECTURE §6).
 *   estimateCostNative tokens/audio × vendor rate → the VENDOR's own currency
 *   capState           spend vs soft/hard cap → OK | WARN | BLOCK
 *   canUse             flag on + grant active + budget not hard-blocked
 *
 * WHY THERE IS NO XAF ESTIMATOR HERE, AND WHY THE LEDGER READ 0.00.
 * Vendor token prices are quoted in the vendor's own currency (USD for every
 * provider seeded here) and they are tiny: DeepSeek chat is $0.00027 per 1k
 * input tokens. Rounding that to 2dp BEFORE the FX conversion — which is what
 * the old XAF-only estimator did, with its one caller passing no rate at all —
 * floors every ordinary call to zero: a 10k-token turn costs $0.0027, and
 * round2($0.0027) is 0.00. The same call in XAF is ~1.7, which survives 2dp.
 *
 * So this file computes native cost only, at 6dp (the precision of
 * ai_usage_ledger.cost_native). Conversion to the tenant's base currency
 * happens once, afterwards, in governance.service with a real rate resolved
 * from MOD-08 — the module that owns FX. Rounding at the end of the chain
 * instead of the middle is the whole fix.
 */
"use strict";
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Cost of one call in the vendor's own currency (`vendor.cost_native_currency`). */
function estimateCostNative({ inputTokens = 0, outputTokens = 0, audioSeconds = 0, vendor = {} }) {
  const inK = Number(inputTokens) / 1000;
  const outK = Number(outputTokens) / 1000;
  const mins = Number(audioSeconds) / 60;
  return round6(
    inK * Number(vendor.cost_per_1k_input_tokens || 0) +
      outK * Number(vendor.cost_per_1k_output_tokens || 0) +
      mins * Number(vendor.cost_per_audio_minute || 0),
  );
}

/** capState(spentXaf, { soft_cap_xaf, hard_cap_xaf }) → OK | WARN | BLOCK. */
function capState(spentXaf, caps = {}) {
  const spent = Number(spentXaf || 0);
  const hard = caps.hard_cap_xaf === null || caps.hard_cap_xaf === undefined ? null : Number(caps.hard_cap_xaf);
  const soft = caps.soft_cap_xaf === null || caps.soft_cap_xaf === undefined ? null : Number(caps.soft_cap_xaf);
  if (hard !== null && spent >= hard) return "BLOCK";
  if (soft !== null && spent >= soft) return "WARN";
  return "OK";
}

/** canUse({ flag, grant, budgetState }) → { allowed, reason }. */
function canUse({ flag, grant, budgetState }) {
  if (!flag || !flag.is_enabled) return { allowed: false, reason: "feature disabled for this tenant" };
  if (!grant || grant.revoked_at) return { allowed: false, reason: "user has no active access grant" };
  if (budgetState === "BLOCK") return { allowed: false, reason: "budget hard cap reached" };
  return { allowed: true, reason: budgetState === "WARN" ? "over soft cap (warned)" : "ok" };
}

module.exports = { estimateCostNative, capState, canUse };
