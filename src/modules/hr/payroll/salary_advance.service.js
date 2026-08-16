/**
 * Salary advances and their recovery (MOD-17 / 0698).
 *
 * ── WHAT THIS CLOSES ───────────────────────────────────────────────────────
 *
 * `leave_request` has carried `kind = 'salary_advance'` and an `amount` since
 * 0330. A manager approved it, the employee was paid, and nothing ever took it
 * back — the service's own comment said recovery was "deferred to the Phase 1
 * posting engine", and the posting engine landed while the recovery did not.
 * Every advance ever approved is an interest-free loan the system has no record
 * of expecting back.
 *
 * ── THE BALANCE IS DERIVED, ALWAYS ─────────────────────────────────────────
 *
 * `outstanding = amount − sum(APPLIED instalments)`. There is no running-total
 * column, for the same reason there is no leave-balance column (0696): it would
 * be written by the run that applies an instalment, the reversal that unwinds
 * one and the correction that reschedules, and would eventually disagree with
 * all three.
 *
 * ── PENDING VERSUS APPLIED ─────────────────────────────────────────────────
 *
 * A payroll run is recomputed freely while it is OPEN or COMPUTED, so an
 * instalment it works out is PENDING and changes nothing. Only VALIDATED —
 * the point at which the money is real — flips it to APPLIED and moves the
 * balance. That is the same rule the variable-pay earnings already follow, and
 * it is what makes recomputing a month free of consequences.
 */
"use strict";
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-17";
const ref = (id) => `salary_advance:${id}`;
const round = (n) => Math.round(Number(n || 0) * 100) / 100;

const SELECT = `
  SELECT a.*, e.full_name AS employee_name,
         coalesce(r.applied, 0)::numeric(18,2) AS recovered,
         (a.amount - coalesce(r.applied, 0))::numeric(18,2) AS outstanding
    FROM salary_advance a
    LEFT JOIN employee e ON e.employee_id = a.employee_id
    LEFT JOIN (
      SELECT salary_advance_id, sum(amount) AS applied
        FROM salary_advance_repayment WHERE status = 'APPLIED'
       GROUP BY salary_advance_id
    ) r ON r.salary_advance_id = a.salary_advance_id`;

async function list(client, q = {}) {
  const params = [];
  const wh = [];
  if (q.employee_id) { params.push(q.employee_id); wh.push(`a.employee_id = $${params.length}`); }
  if (q.status) { params.push(q.status); wh.push(`a.status = $${params.length}`); }
  const { rows } = await client.query(
    `${SELECT} ${wh.length ? "WHERE " + wh.join(" AND ") : ""} ORDER BY a.created_at DESC`,
    params,
  );
  return rows;
}

async function get(client, id) {
  const { rows } = await client.query(`${SELECT} WHERE a.salary_advance_id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: repayments } = await client.query(
    `SELECT r.*, pr.status AS run_status
       FROM salary_advance_repayment r
       LEFT JOIN payroll_run pr ON pr.payroll_run_id = r.payroll_run_id
      WHERE r.salary_advance_id = $1
      ORDER BY r.period_code`,
    [id],
  );
  return { ...rows[0], repayments };
}

/** An employee's own advances (My HR) — "what do I still owe?" */
const mine = (client, employeeId) => (employeeId ? list(client, { employee_id: employeeId }) : Promise.resolve([]));

async function create(client, { data, actor = {} }) {
  const instalments = Number(data.instalments || 1);
  const amount = round(data.amount);
  // Derived unless stated: an employer agreeing "300,000 over three months"
  // should not have to do the division, and a plan whose instalments cannot
  // reach the amount is a plan that never finishes.
  const instalmentAmount = round(data.instalment_amount || amount / instalments);
  if (instalmentAmount <= 0) {
    throw new AppError("VALIDATION_ERROR", "The instalment must be more than nothing", 422, {
      instalment_amount: ["Set an amount above zero."],
    });
  }
  if (round(instalmentAmount * instalments) < amount) {
    throw new AppError("VALIDATION_ERROR", "These instalments never clear the advance", 422, {
      instalment_amount: [`${instalments} × ${instalmentAmount} does not reach ${amount}.`],
    });
  }
  const actorId = await resolveActorId(client, actor.user_id);
  const { rows } = await client.query(
    `INSERT INTO salary_advance (employee_id, leave_request_id, entity_id, amount, instalments,
                                 instalment_amount, first_period_code, status, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'ACTIVE'),$9,$10) RETURNING *`,
    [data.employee_id, data.leave_request_id ?? null, data.entity_id ?? null, amount, instalments,
      instalmentAmount, data.first_period_code, data.status, data.note ?? null, actorId],
  );
  await audit(client, { actorUserId: actorId, action: "salary_advance.created", moduleKey: MODULE, entityRef: ref(rows[0].salary_advance_id), after: rows[0] });
  return get(client, rows[0].salary_advance_id);
}

const PATCHABLE = ["instalments", "instalment_amount", "first_period_code", "status", "note"];

async function update(client, { id, patch, actor = {} }) {
  const before = await get(client, id);
  if (!before) return null;
  if (before.status === "SETTLED" && patch.status !== "ACTIVE") {
    // Reopening a settled plan is a deliberate act, not a side effect of
    // editing a note on it.
    throw new AppError("INVALID_TRANSITION", "This advance is fully recovered", 422);
  }
  const sets = [];
  const params = [id];
  for (const c of PATCHABLE) {
    if (patch[c] === undefined) continue;
    params.push(patch[c]);
    sets.push(`${c} = $${params.length}`);
  }
  if (!sets.length) return before;
  const actorId = await resolveActorId(client, actor.user_id);
  await client.query(`UPDATE salary_advance SET ${sets.join(", ")}, updated_at = now() WHERE salary_advance_id = $1`, params);
  const after = await get(client, id);
  // Writing one off forgives real money. Named separately so it is findable in
  // the audit rather than sitting inside a generic "updated".
  const action = patch.status === "WRITTEN_OFF" && before.status !== "WRITTEN_OFF"
    ? "salary_advance.written_off"
    : "salary_advance.updated";
  await audit(client, { actorUserId: actorId, action, moduleKey: MODULE, entityRef: ref(id), before, after });
  return after;
}

/**
 * What each employee should repay in a period.
 *
 * ACTIVE plans only, and only once recovery has started (`first_period_code`).
 * The instalment is capped at what is still owed, so the last one is the
 * remainder rather than an overpayment the employer then has to give back.
 */
async function dueForPeriod(client, { periodCode, entityId = null }) {
  const params = [periodCode];
  let entity = "";
  if (entityId) {
    params.push(entityId);
    // A plan with no entity belongs to whoever is running payroll — an advance
    // recorded before entities were used must not become unrecoverable.
    entity = `AND (a.entity_id IS NULL OR a.entity_id = $${params.length})`;
  }
  const { rows } = await client.query(
    `${SELECT}
      WHERE a.status = 'ACTIVE'
        AND a.first_period_code <= $1
        ${entity}`,
    params,
  );
  return rows
    .map((a) => {
      // Already computed for this period by an earlier pass over the same run.
      const due = round(Math.min(Number(a.instalment_amount), Number(a.outstanding)));
      return { ...a, due };
    })
    .filter((a) => a.due > 0);
}

/**
 * Record what a run intends to recover. PENDING — nothing has moved yet.
 *
 * Called on every recompute, so it replaces rather than accumulates: the unique
 * index refuses a second live row for the same (plan, period), and a recompute
 * that lands on a smaller figure must not leave the larger one behind.
 */
async function schedule(client, { advanceId, periodCode, payrollRunId, amount }) {
  const { rows } = await client.query(
    `INSERT INTO salary_advance_repayment (salary_advance_id, period_code, payroll_run_id, amount, status)
     VALUES ($1,$2,$3,$4,'PENDING')
     ON CONFLICT (salary_advance_id, period_code) WHERE status <> 'REVERSED'
     DO UPDATE SET amount = EXCLUDED.amount, payroll_run_id = EXCLUDED.payroll_run_id, updated_at = now()
       WHERE salary_advance_repayment.status = 'PENDING'
     RETURNING *`,
    [advanceId, periodCode, payrollRunId ?? null, amount],
  );
  // Null = the row exists and is already APPLIED. That period was validated;
  // recomputing must not reopen it, and the caller reads the applied figure.
  return rows[0] || null;
}

/** Drop this run's PENDING instalments — a recompute starts from clean. */
async function clearPending(client, { payrollRunId }) {
  await client.query("DELETE FROM salary_advance_repayment WHERE payroll_run_id = $1 AND status = 'PENDING'", [payrollRunId]);
}

/**
 * The run was validated: the money is real. Instalments become APPLIED, and any
 * plan they finish is SETTLED in the same pass — so a fully-recovered advance
 * stops being taken from the next payslip without anybody having to notice.
 */
async function applyForRun(client, { payrollRunId, actor = {} }) {
  const { rows } = await client.query(
    `UPDATE salary_advance_repayment SET status = 'APPLIED', updated_at = now()
      WHERE payroll_run_id = $1 AND status = 'PENDING'
      RETURNING salary_advance_id, amount, period_code`,
    [payrollRunId],
  );
  if (!rows.length) return { applied: 0, settled: 0 };
  const { rows: settled } = await client.query(
    `UPDATE salary_advance a SET status = 'SETTLED', updated_at = now()
      WHERE a.salary_advance_id = ANY($1)
        AND a.status = 'ACTIVE'
        AND a.amount <= (SELECT coalesce(sum(r.amount), 0) FROM salary_advance_repayment r
                          WHERE r.salary_advance_id = a.salary_advance_id AND r.status = 'APPLIED')
      RETURNING salary_advance_id`,
    [rows.map((r) => r.salary_advance_id)],
  );
  const actorId = await resolveActorId(client, actor.user_id);
  await audit(client, {
    actorUserId: actorId,
    action: "salary_advance.recovered",
    moduleKey: MODULE,
    entityRef: `payroll_run:${payrollRunId}`,
    after: { instalments: rows.length, settled: settled.length, total: round(rows.reduce((n, r) => n + Number(r.amount), 0)) },
  });
  return { applied: rows.length, settled: settled.length };
}

module.exports = { list, get, mine, create, update, dueForPeriod, schedule, clearPending, applyForRun };
