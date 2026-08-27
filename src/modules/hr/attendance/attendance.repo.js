/**
 * Attendance repository (MOD-14). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee, open shifts, or date).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { updateOne } = require("../../../shared/db/query-helpers");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "attendance_log", pk: "attendance_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
});

module.exports = {
  ...base,

  // ── Self-service resolution ──
  async employeeIdForUser(client, userId) {
    const { rows } = await client.query("SELECT employee_id FROM app_user WHERE user_id = $1", [userId]);
    return rows[0] ? rows[0].employee_id : null;
  },
  async entityForEmployee(client, employeeId) {
    const { rows } = await client.query("SELECT entity_id FROM employee WHERE employee_id = $1", [employeeId]);
    return rows[0] ? rows[0].entity_id : null;
  },
  async openForEmployee(client, employeeId) {
    const { rows } = await client.query(
      "SELECT * FROM attendance_log WHERE employee_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1",
      [employeeId],
    );
    return rows[0] || null;
  },

  // ── Worksites (geofence centres) ──
  activeSitesForEntity(client, entityId) {
    return client
      .query(
        "SELECT * FROM work_site WHERE is_active = true AND (entity_id = $1 OR entity_id IS NULL) ORDER BY name",
        [entityId],
      )
      .then((r) => r.rows);
  },
  listSites(client) {
    return client.query("SELECT * FROM work_site ORDER BY is_active DESC, name").then((r) => r.rows);
  },
  getSite(client, id) {
    return client.query("SELECT * FROM work_site WHERE work_site_id = $1", [id]).then((r) => r.rows[0] || null);
  },
  insertSite(client, data) {
    const { entity_id = null, name, latitude, longitude, radius_m = 150, is_active = true } = data;
    return client
      .query(
        "INSERT INTO work_site (entity_id, name, latitude, longitude, radius_m, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [entity_id, name, latitude, longitude, radius_m, is_active],
      )
      .then((r) => r.rows[0]);
  },
  async updateSite(client, id, fields) {
    // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
    // identifier validation and writable allow-list in query-helpers.
    if (!Object.keys(fields).length) return this.getSite(client, id);
    return updateOne(client, "work_site", "work_site_id", id, fields, "*", null, { touch: "updated_at" });
  },

  // ── Registered devices (0524) ──
  /**
   * See a device: create it PENDING, or bump `last_seen_at` on the row that is
   * already there. Returns the row either way.
   *
   * ON CONFLICT rather than SELECT-then-INSERT because two punches racing from
   * the same freshly-installed device would otherwise both miss the select and
   * both insert, and the unique index would fail the second — a punch lost to a
   * constraint violation the user cannot act on.
   *
   * `(xmax = 0) AS inserted` distinguishes the INSERT from the UPDATE — an
   * upsert otherwise returns the same row either way, and the caller cannot tell
   * a device it has just met from one it sees every morning. It is the signal
   * that lets the clock ask "name this device?" exactly once, on the punch that
   * created it, instead of nagging on every punch forever.
   *
   * The status is DELIBERATELY NOT in the update list. A revoked device that
   * reappears must stay revoked; letting the upsert reset it to PENDING would
   * make revocation decay back into "nobody has looked yet" every time the
   * device was used again, which is the opposite of what revoking means. The
   * label is only refreshed while it is still the auto-seeded one, so an
   * employee's rename survives them opening the app on a new browser version.
   */
  upsertDevice(client, { employeeId, fingerprint, label, userAgent = null, platform = null }) {
    return client
      .query(
        `INSERT INTO hr_device (employee_id, fingerprint, label, user_agent, platform)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (employee_id, fingerprint) DO UPDATE
            SET last_seen_at = now(),
                updated_at   = now(),
                user_agent   = COALESCE(EXCLUDED.user_agent, hr_device.user_agent),
                platform     = COALESCE(EXCLUDED.platform, hr_device.platform)
          RETURNING *, (xmax = 0) AS inserted`,
        [employeeId, fingerprint, label, userAgent, platform],
      )
      .then((r) => r.rows[0]);
  },
  listDevices(client, { employeeId = null } = {}) {
    const params = [];
    let where = "";
    if (employeeId) { params.push(employeeId); where = "WHERE d.employee_id = $1"; }
    return client
      .query(
        `SELECT d.*, e.full_name AS employee_name
           FROM hr_device d
           LEFT JOIN employee e ON e.employee_id = d.employee_id
           ${where}
          ORDER BY (d.status = 'PENDING') DESC, d.last_seen_at DESC`,
        params,
      )
      .then((r) => r.rows);
  },
  getDevice(client, id) {
    return client.query("SELECT * FROM hr_device WHERE hr_device_id = $1", [id]).then((r) => r.rows[0] || null);
  },
  updateDevice(client, id, fields) {
    if (!Object.keys(fields).length) return this.getDevice(client, id);
    return updateOne(client, "hr_device", "hr_device_id", id, fields, "*", null, { touch: "updated_at" });
  },

  /**
   * The local-zone day window, as WHERE fragments — the ONE definition.
   *
   * Never `clock_in_at::date`: that is the UTC date, so a 00:30 Douala punch
   * lands on the previous day and disappears from Today. Extracted here when
   * the report range (PR2) needed the same predicate as the paged log — two
   * copies of this comparison is how one of them gets fixed and the other does
   * not.
   *
   * Mutates `params` (pushing the bind values it needs) and returns the
   * fragments, which is the shape every builder in this repo already uses.
   */
  dayWindowSql(params, q = {}, tz = "Africa/Douala") {
    const wh = [];
    const geAt = (value) => {
      params.push(value, tz);
      return "al.clock_in_at >= ($" + (params.length - 1) + "::timestamp AT TIME ZONE $" + params.length + ")";
    };
    const ltNextDay = (value) => {
      params.push(value, tz);
      return "al.clock_in_at <  (($" + (params.length - 1) + "::date + 1)::timestamp AT TIME ZONE $" + params.length + ")";
    };
    if (q.date) {
      wh.push(geAt(q.date), ltNextDay(q.date));
    } else {
      if (q.from) wh.push(geAt(q.from));
      if (q.to) wh.push(ltNextDay(q.to));
    }
    return wh;
  },

  /**
   * An employee-id filter off a query string, normalised and BOUNDED.
   *
   * `GET /attendance` has never had a query schema — it takes `date`,
   * `employee_id`, `open` and the page — so the PR2 `employee_ids` filter is
   * normalised here rather than by adding a strict validator that would start
   * refusing parameters existing callers already send.
   *
   * Express hands one value over as a string and several as an array; people
   * also paste comma-separated lists. All three collapse to an array. Non-uuid
   * elements are DROPPED rather than passed on: the array lands in Postgres as
   * a `uuid[]` bind, where junk is a driver-level 500 instead of an empty
   * result. Capped at 50, the same compare set the validator allows.
   */
  idList(value, cap = 50) {
    if (value === undefined || value === null || value === "") return [];
    const list = Array.isArray(value) ? value : String(value).split(",");
    const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return list.map((v) => String(v).trim()).filter((v) => uuid.test(v)).slice(0, cap);
  },

  /** The workplace zone a caller asked for, or Douala. */
  zoneOf(q = {}) {
    return typeof q.timeZone === "string" && q.timeZone.trim() ? q.timeZone.trim() : "Africa/Douala";
  },

  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("al.employee_id = $" + params.length); }
    // PR2: the log accepts a SET of employees, not only one. `= ANY($n)` rather
    // than an interpolated IN list — the array is one bind parameter, so the
    // shape cannot be widened by whatever the caller put in it.
    const idSet = this.idList(q.employee_ids);
    if (idSet.length) {
      params.push(idSet);
      wh.push("al.employee_id = ANY($" + params.length + "::uuid[])");
    }
    if (q.department) {
      // Same match as employees.repo: case- and whitespace-insensitive, because
      // exact equality made "Operations" and "operations" two departments.
      params.push(q.department);
      wh.push(`lower(btrim(e.department)) = lower(btrim($${params.length}))`);
    }
    if (q.open === "true" || q.open === true) wh.push("al.clock_out_at IS NULL");
    wh.push(...this.dayWindowSql(params, q, this.zoneOf(q)));
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name, e.department
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         ${where}
        ORDER BY al.clock_in_at DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  /**
   * The roster a report covers — WHO, before any punch or day row is read.
   *
   * Analytics counts expected working days per person, so it needs the people
   * even when they have no rows at all: an employee who was absent for the
   * whole window has nothing in `attendance_day` until reconciliation runs, and
   * without this they would simply not appear. "No data" and "never turned up"
   * must not look the same.
   *
   * `is_active` is applied ONLY when nobody was named. Asking for a specific
   * employee (their own history, an employee 360) must still answer after they
   * leave — their last month is exactly what payroll is looking at.
   */
  async rosterForReport(client, { employeeId = null, employeeIds = null, department = null, limit = 2000 } = {}) {
    const params = [];
    const wh = [];
    const set = this.idList(employeeIds);
    if (employeeId) { params.push(employeeId); wh.push("e.employee_id = $" + params.length); }
    if (set.length) { params.push(set); wh.push("e.employee_id = ANY($" + params.length + "::uuid[])"); }
    if (department) {
      params.push(department);
      wh.push(`lower(btrim(e.department)) = lower(btrim($${params.length}))`);
    }
    if (!employeeId && !set.length) wh.push("e.is_active");
    params.push(Math.min(Math.max(Number(limit) || 2000, 1), 2000));
    const { rows } = await client.query(
      `SELECT e.employee_id, e.full_name, e.department, e.entity_id,
              e.work_days, e.expected_start_time, e.grace_minutes
         FROM employee e
        ${wh.length ? "WHERE " + wh.join(" AND ") : ""}
        ORDER BY e.full_name
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  },

  /**
   * Punches over a window, for a REPORT — analytics, export, and the employee's
   * own history.
   *
   * Separate from `list` because the two are bounded differently on purpose:
   * `list` is a page (`page()` clamps it to 200) and this is a file. It takes a
   * hard `limit` instead, and the caller compares the row count against it to
   * know whether the answer was cut short — an export that silently drops the
   * second half of a month is worse than one that says it did.
   *
   * The device label is joined here rather than looked up per row: an export of
   * 20k punches would otherwise be 20k queries.
   */
  async punchesForRange(client, { from, to, employeeIds = null, employeeId = null, department = null, timeZone = null, limit = 20000 } = {}) {
    const cap = Math.min(Math.max(Number(limit) || 20000, 1), 20000);
    const params = [];
    const wh = [];
    if (employeeId) { params.push(employeeId); wh.push("al.employee_id = $" + params.length); }
    const idSet = this.idList(employeeIds);
    if (idSet.length) {
      params.push(idSet);
      wh.push("al.employee_id = ANY($" + params.length + "::uuid[])");
    }
    if (department) {
      params.push(department);
      wh.push(`lower(btrim(e.department)) = lower(btrim($${params.length}))`);
    }
    wh.push(...this.dayWindowSql(params, { from, to }, this.zoneOf({ timeZone })));
    params.push(cap);
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name, e.department, e.entity_id,
              dev.label AS device_label
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         LEFT JOIN hr_device dev ON dev.hr_device_id = al.hr_device_id
        ${wh.length ? "WHERE " + wh.join(" AND ") : ""}
        ORDER BY al.clock_in_at DESC NULLS LAST
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  },
};
