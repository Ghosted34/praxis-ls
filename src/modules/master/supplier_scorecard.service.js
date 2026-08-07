/**
 * Supplier AVL scorecard (PR3-C §3.3).
 *
 * The six sub-score columns (score_on_time / _claims / _disputes /
 * _responsiveness / _safety / _compliance) and score_overall exist on
 * supplier_master since 0511, but nothing computed them. This derives them from
 * the real operational data we have — purchase-order fulfilment, open compliance
 * flags, and interaction activity — with documented fallbacks for the signals a
 * dedicated source does not exist for yet (claims / HSE), and stamps
 * last_evaluated_at.
 *
 * `computeScores` is PURE (unit-tested directly); `evaluate` gathers the inputs
 * on the tenant connection and persists the result. Run on 360 load; a nightly
 * worker is optional (the brief allows on-demand for v1).
 */
"use strict";

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (part, total, fallback) => (total > 0 ? clamp((part / total) * 100) : fallback);

/**
 * The six sub-scores + weighted overall from clean numeric inputs.
 *
 * @param {object} i
 * @param {number} i.poClosed       purchase orders closed (fulfilled)
 * @param {number} i.poCancelled    purchase orders cancelled
 * @param {number} i.poTotal        purchase orders total
 * @param {number} i.openFlags      open compliance flags on the supplier
 * @param {number} i.escalatedFlags open flags at ESCALATED/soft-block/hard-block
 * @param {number} i.activity       interaction events logged against the supplier
 */
function computeScores(i = {}) {
  const poDecided = (i.poClosed || 0) + (i.poCancelled || 0);
  const on_time = pct(i.poClosed || 0, poDecided, 80);
  const disputes = i.poTotal > 0 ? clamp(100 - ((i.poCancelled || 0) / i.poTotal) * 100) : 90;
  // No claims / HSE feed yet (deferred): documented neutral-positive fallbacks.
  const claims = 90;
  const safety = 85;
  const responsiveness = (i.activity || 0) > 0 ? clamp(60 + (i.activity || 0) * 3) : 75;
  const compliance = clamp(100 - (i.openFlags || 0) * 8 - (i.escalatedFlags || 0) * 7);
  const overall = clamp(
    on_time * 0.3 + compliance * 0.25 + disputes * 0.2 + responsiveness * 0.1 + claims * 0.1 + safety * 0.05,
  );
  return {
    score_on_time: on_time, score_claims: claims, score_disputes: disputes,
    score_responsiveness: responsiveness, score_safety: safety, score_compliance: compliance,
    score_overall: overall,
  };
}

async function count(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0] && rows[0].n) || 0;
}

/** Gather the inputs, compute, persist on supplier_master, and return the scores. */
async function evaluate(client, { supplierId }) {
  const poClosed = await count(client, "SELECT count(*)::int AS n FROM purchase_order WHERE supplier_id = $1 AND status = 'CLOSED'", [supplierId]);
  const poCancelled = await count(client, "SELECT count(*)::int AS n FROM purchase_order WHERE supplier_id = $1 AND status = 'CANCELLED'", [supplierId]);
  const poTotal = await count(client, "SELECT count(*)::int AS n FROM purchase_order WHERE supplier_id = $1", [supplierId]);
  const openFlags = await count(client, "SELECT count(*)::int AS n FROM compliance_flag WHERE entity_ref = $1 AND resolved_at IS NULL", [`supplier:${supplierId}`]);
  const escalatedFlags = await count(
    client,
    "SELECT count(*)::int AS n FROM compliance_flag WHERE entity_ref = $1 AND resolved_at IS NULL AND severity = ANY($2)",
    [`supplier:${supplierId}`, ["ESCALATED", "RED", "SOFT_BLOCK_RECOMMENDATION", "HARD_BLOCK"]],
  );
  const activity = await count(client, "SELECT count(*)::int AS n FROM event_log WHERE entity_ref = $1", [`supplier:${supplierId}`]);

  const scores = computeScores({ poClosed, poCancelled, poTotal, openFlags, escalatedFlags, activity });
  await client.query(
    `UPDATE supplier_master
        SET score_on_time = $2, score_claims = $3, score_disputes = $4, score_responsiveness = $5,
            score_safety = $6, score_compliance = $7, score_overall = $8, last_evaluated_at = now()
      WHERE supplier_id = $1`,
    [supplierId, scores.score_on_time, scores.score_claims, scores.score_disputes, scores.score_responsiveness, scores.score_safety, scores.score_compliance, scores.score_overall],
  );
  return { ...scores, last_evaluated_at: new Date().toISOString() };
}

module.exports = { computeScores, evaluate };
