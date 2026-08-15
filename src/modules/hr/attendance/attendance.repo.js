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
          RETURNING *`,
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

  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("al.employee_id = $" + params.length); }
    if (q.open === "true" || q.open === true) wh.push("al.clock_out_at IS NULL");
    if (q.date) { params.push(q.date); wh.push("al.clock_in_at::date = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         ${where}
        ORDER BY al.clock_in_at DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
