/**
 * Employee earnings repo (variable pay). Shared by appraisal (creates a reward)
 * and payroll (consumes it into gross, then marks it applied). All SQL here.
 */
"use strict";

module.exports = {
  /**
   * Create or update an earning keyed by source_ref. Returns the row, or null
   * when the existing earning is already APPLIED (locked — can't change a paid one).
   */
  async upsertFromSource(client, { employee_id, entity_id, period_code, kind = "BONUS", label = null, amount, source_ref, created_by = null }) {
    const { rows } = await client.query(
      `INSERT INTO employee_earning (employee_id, entity_id, period_code, kind, label, amount, source_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL
       DO UPDATE SET amount = EXCLUDED.amount, label = EXCLUDED.label, period_code = EXCLUDED.period_code,
                     kind = EXCLUDED.kind, status = 'PENDING', updated_at = now()
             WHERE employee_earning.status = 'PENDING'
       RETURNING *`,
      [employee_id, entity_id, period_code, kind, label, amount, source_ref, created_by],
    );
    return rows[0] || null;
  },

  /** PENDING earnings for a run's entity+period, grouped per employee. */
  async pendingByEntityPeriod(client, entityId, periodCode) {
    const { rows } = await client.query(
      "SELECT employee_id, SUM(amount)::numeric(18,2) AS total, " +
        "json_agg(json_build_object('label', label, 'kind', kind, 'amount', amount)) AS lines " +
        "FROM employee_earning WHERE entity_id = $1 AND period_code = $2 AND status = 'PENDING' " +
        "GROUP BY employee_id",
      [entityId, periodCode],
    );
    return rows;
  },

  /** Consume the run's pending earnings (once the run is validated). */
  async markAppliedForRun(client, { runId, entityId, periodCode }) {
    await client.query(
      "UPDATE employee_earning SET status = 'APPLIED', payroll_run_id = $1, updated_at = now() " +
        "WHERE entity_id = $2 AND period_code = $3 AND status = 'PENDING'",
      [runId, entityId, periodCode],
    );
  },

  /** Reward lookups for a set of source refs (e.g. appraisal list decoration). */
  async bySourceRefs(client, refs) {
    if (!refs || !refs.length) return {};
    const { rows } = await client.query(
      "SELECT source_ref, amount, status, period_code FROM employee_earning WHERE source_ref = ANY($1)",
      [refs],
    );
    const m = {};
    for (const r of rows) m[r.source_ref] = r;
    return m;
  },
};
