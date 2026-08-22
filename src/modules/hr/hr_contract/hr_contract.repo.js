/**
 * HR-contract repository (MOD-12). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee/status/kind).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "hr_contract", pk: "hr_contract_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
});

module.exports = {
  ...base,

  /** One contract with everything a draft needs: the employee, their entity,
   *  and the vacancy it came from. One query, because the drafter is called
   *  outside a transaction and should not hold a connection across three. */
  async context(client, id) {
    const { rows } = await client.query(
      `SELECT hc.*, e.full_name AS employee_name, e.department, e.job_title AS employee_job_title,
              e.base_salary, e.hired_on,
              -- country_code, not country: 0100 named it that, and 0515 built
              -- payroll_country / incorporation_country on top of it. The alias
              -- stays entity_country -- hr_contract.draft prints it beside the
              -- employer name, and a two-letter code is what that line has
              -- always shown.
              ce.legal_name AS entity_name, ce.country_code AS entity_country,
              v.title AS vacancy_title
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         LEFT JOIN corporate_entity ce ON ce.entity_id = coalesce(hc.entity_id, e.entity_id)
         LEFT JOIN vacancy v ON v.vacancy_id = hc.vacancy_id
        WHERE hc.hr_contract_id = $1`,
      [id],
    );
    return rows[0] || null;
  },

  /** The handbook, by title. Titles only — see hr_contract.draft for why. */
  async sopTitles(client) {
    const { rows } = await client.query(
      "SELECT title FROM sop_document WHERE is_active ORDER BY title LIMIT 12",
    );
    return rows.map((r) => r.title);
  },

  /**
   * Contracts whose term or probation lapses within `days`.
   *
   * ISSUED and SIGNED only: a DRAFT has not been given to anybody, and an ENDED
   * one has already lapsed. `already` excludes the ones an event was emitted
   * for inside the same window, so a daily watcher warns once per contract per
   * window rather than every morning until somebody acts.
   */
  async lapsingWithin(client, { days = 30, kind = "expiry" } = {}) {
    const column = kind === "probation" ? "probation_ends_on" : "end_on";
    const eventKey = kind === "probation" ? "hr_contract.probation_ending" : "hr_contract.expiring";
    const { rows } = await client.query(
      `SELECT hc.hr_contract_id, hc.employee_id, hc.kind, hc.status, hc.effective_on,
              hc.end_on, hc.probation_ends_on, hc.title, e.full_name AS employee_name,
              (hc.${column} - CURRENT_DATE)::int AS days_left
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
        WHERE hc.status IN ('ISSUED','SIGNED')
          AND hc.${column} IS NOT NULL
          AND hc.${column} >= CURRENT_DATE
          AND hc.${column} <= CURRENT_DATE + ($1 || ' days')::interval
          AND NOT EXISTS (
            SELECT 1 FROM event_log o
             WHERE o.entity_ref = 'hr_contract:' || hc.hr_contract_id
               AND o.event_type_key = $2
               AND o.created_at > now() - ($1 || ' days')::interval
          )
        ORDER BY hc.${column}`,
      [String(days), eventKey],
    );
    return rows;
  },
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("hc.employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("hc.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("hc.kind = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT hc.*, e.full_name AS employee_name
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         ${where}
        ORDER BY hc.effective_on DESC NULLS LAST, hc.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  /**
   * The corporate entity a contract numbers under. `hr_contract.entity_id` is
   * nullable and older rows leave it unset, so fall back to the employee's —
   * the same COALESCE the document template already does when it resolves the
   * letterhead. Returns null when neither has one, and the caller then issues
   * without a number rather than failing the transition.
   */
  async entityIdFor(client, { contractId, employeeId }) {
    const { rows } = await client.query(
      `SELECT COALESCE(hc.entity_id, e.entity_id) AS entity_id
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
        WHERE hc.hr_contract_id = $1 AND ($2::uuid IS NULL OR hc.employee_id = $2)`,
      [contractId, employeeId || null],
    );
    return (rows[0] && rows[0].entity_id) || null;
  },
};
