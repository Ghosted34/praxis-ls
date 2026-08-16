/**
 * Leave/allowance repository (MOD-15). Factory base + a bespoke joined/filtered
 * list (employee name, filter by employee/status/kind), the leave-type and
 * holiday catalogues, and the entitlement ledger (0696).
 *
 * Nothing here computes a balance: `ledgerFor` returns the movements and
 * `leave.rules.balanceFrom` folds them, so the arithmetic is unit-testable
 * without a database and there is exactly one implementation of it.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "leave_request", pk: "leave_request_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
});

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("lr.employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("lr.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("lr.kind = $" + params.length); }
    if (q.leave_type_id) { params.push(q.leave_type_id); wh.push("lr.leave_type_id = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT lr.*, e.full_name AS employee_name,
              lt.code AS leave_type_code, lt.name AS leave_type_name, lt.is_paid AS leave_type_is_paid
         FROM leave_request lr
         LEFT JOIN employee e ON e.employee_id = lr.employee_id
         LEFT JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
         ${where}
        ORDER BY lr.starts_on DESC NULLS LAST, lr.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  /* ── Leave types ────────────────────────────────────────────────────────── */

  async listTypes(client, { includeInactive = false } = {}) {
    const { rows } = await client.query(
      `SELECT * FROM leave_type
        ${includeInactive ? "" : "WHERE is_active"}
        ORDER BY is_system DESC, name`,
    );
    return rows;
  },
  async findType(client, id) {
    const { rows } = await client.query("SELECT * FROM leave_type WHERE leave_type_id = $1", [id]);
    return rows[0] || null;
  },
  async findTypeByCode(client, code) {
    const { rows } = await client.query("SELECT * FROM leave_type WHERE code = $1", [code]);
    return rows[0] || null;
  },
  async insertType(client, data) {
    const { rows } = await client.query(
      `INSERT INTO leave_type (code, name, is_paid, accrual_days_per_month, max_days_per_year,
                               max_carryover_days, requires_document, counts_working_days,
                               allow_negative, is_active)
       VALUES ($1,$2,coalesce($3,true),$4,$5,coalesce($6,0),coalesce($7,false),
               coalesce($8,true),coalesce($9,false),coalesce($10,true))
       RETURNING *`,
      [data.code, data.name, data.is_paid, data.accrual_days_per_month ?? null, data.max_days_per_year ?? null,
        data.max_carryover_days, data.requires_document, data.counts_working_days, data.allow_negative, data.is_active],
    );
    return rows[0];
  },
  async updateType(client, id, patch) {
    // Named columns rather than a generic setter: `code` is what the ledger and
    // the accrual job resolve types by, and `is_system` marks the seeded set —
    // neither is patchable from an HTTP body.
    const cols = ["name", "is_paid", "accrual_days_per_month", "max_days_per_year",
      "max_carryover_days", "requires_document", "counts_working_days", "allow_negative", "is_active"];
    const sets = [];
    const params = [id];
    for (const c of cols) {
      if (patch[c] === undefined) continue;
      params.push(patch[c]);
      sets.push(`${c} = $${params.length}`);
    }
    if (!sets.length) return module.exports.findType(client, id);
    const { rows } = await client.query(
      `UPDATE leave_type SET ${sets.join(", ")} WHERE leave_type_id = $1 RETURNING *`, params);
    return rows[0] || null;
  },

  /* ── Public holidays ────────────────────────────────────────────────────── */

  async listHolidays(client, { includeInactive = false } = {}) {
    const { rows } = await client.query(
      `SELECT * FROM public_holiday
        ${includeInactive ? "" : "WHERE is_active"}
        ORDER BY is_recurring DESC, holiday_on`,
    );
    return rows;
  },
  async insertHoliday(client, data) {
    const { rows } = await client.query(
      `INSERT INTO public_holiday (holiday_on, name, is_recurring)
       VALUES ($1,$2,coalesce($3,false))
       ON CONFLICT (holiday_on) DO UPDATE SET name = EXCLUDED.name, is_recurring = EXCLUDED.is_recurring, is_active = true
       RETURNING *`,
      [data.holiday_on, data.name, data.is_recurring],
    );
    return rows[0];
  },
  async deactivateHoliday(client, id) {
    const { rows } = await client.query(
      "UPDATE public_holiday SET is_active = false WHERE public_holiday_id = $1 RETURNING *", [id]);
    return rows[0] || null;
  },

  /* ── The entitlement ledger ─────────────────────────────────────────────── */

  /** Every movement for one employee, optionally narrowed to a type/year. */
  async ledgerFor(client, { employeeId, leaveTypeId = null, year = null }) {
    const params = [employeeId];
    const wh = ["l.employee_id = $1"];
    if (leaveTypeId) { params.push(leaveTypeId); wh.push(`l.leave_type_id = $${params.length}`); }
    if (year) { params.push(year); wh.push(`l.period_year = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT l.*, lt.code AS leave_type_code, lt.name AS leave_type_name
         FROM leave_ledger l
         JOIN leave_type lt ON lt.leave_type_id = l.leave_type_id
        WHERE ${wh.join(" AND ")}
        ORDER BY l.created_at`,
      params,
    );
    return rows;
  },

  async insertLedger(client, e) {
    const { rows } = await client.query(
      `INSERT INTO leave_ledger (employee_id, leave_type_id, period_year, period_month, kind, days,
                                 leave_request_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [e.employee_id, e.leave_type_id, e.period_year, e.period_month ?? null, e.kind, e.days,
        e.leave_request_id ?? null, e.note ?? null, e.created_by ?? null],
    );
    return rows[0];
  },

  /** The accrual job's insert. `ON CONFLICT DO NOTHING` against
   *  `ux_leave_ledger_accrual` is what makes re-running a month free. */
  async insertAccrual(client, e) {
    const { rows } = await client.query(
      `INSERT INTO leave_ledger (employee_id, leave_type_id, period_year, period_month, kind, days, note)
       VALUES ($1,$2,$3,$4,'ACCRUAL',$5,$6)
       ON CONFLICT (employee_id, leave_type_id, period_year, period_month) WHERE kind = 'ACCRUAL'
       DO NOTHING
       RETURNING *`,
      [e.employee_id, e.leave_type_id, e.period_year, e.period_month, e.days, e.note ?? null],
    );
    return rows[0] || null;
  },

  /** Requests that could clash with a proposed one. Terminal states are
   *  excluded — a rejected or cancelled request occupies no calendar. */
  async overlappingRequests(client, { employeeId, exceptId = null }) {
    const params = [employeeId];
    let except = "";
    if (exceptId) { params.push(exceptId); except = `AND leave_request_id <> $${params.length}`; }
    const { rows } = await client.query(
      `SELECT leave_request_id, starts_on, ends_on, status
         FROM leave_request
        WHERE employee_id = $1
          AND status IN ('REQUESTED','APPROVED','TAKEN')
          AND starts_on IS NOT NULL AND ends_on IS NOT NULL
          ${except}`,
      params,
    );
    return rows;
  },

  /** Active employees for the accrual job, with the date service started. */
  async accrualRoster(client) {
    const { rows } = await client.query(
      `SELECT employee_id, full_name, hired_on
         FROM employee
        WHERE is_active
        ORDER BY employee_id`,
    );
    return rows;
  },
};
