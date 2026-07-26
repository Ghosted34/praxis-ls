/**
 * Attendance (MOD-14) — geofenced clock-in/out.
 *
 * Clock-in captures the device GPS, resolves the nearest active worksite
 * (haversine), decides on-site/off-site vs its radius, reverse-geocodes the point
 * to an address (geoapify, best-effort), and applies the tenant geofence policy
 * `hr.geofence` = off | warn | block (default warn). Worksites are the geofence
 * centres, managed here. Admin CRUD stays for corrections; the day-to-day surface
 * is the clock in/out + worksite actions.
 */
"use strict";

const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const repo = require("./attendance.repo");
const events = require("./attendance.events");
const employeeService = require("../../master/employees/employees.service");
const geoapify = require("../../../services/geoapify.service");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "attendance", events });

/** Great-circle distance in metres between two WGS-84 points. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** off | warn | block (default warn). Stored as a plain string or { mode }. */
async function geofenceMode(client) {
  const v = await getSetting(client, "hr", "geofence", "warn");
  const mode = typeof v === "string" ? v : (v && v.mode) || "warn";
  return ["off", "warn", "block"].includes(mode) ? mode : "warn";
}

/**
 * Resolve a captured point against the entity's worksites + reverse-geocode it.
 * within = true/false when a site exists; null when no coords or no sites (so the
 * "block" policy never traps a tenant that hasn't defined any geofence yet).
 */
async function resolveGeo(client, { entityId, lat, lng }) {
  const has = lat !== null && lat !== undefined && lng !== null && lng !== undefined;
  const label = has ? await geoapify.reverseGeocode(lat, lng) : null;
  if (!has) return { work_site_id: null, distance_m: null, within: null, label: null };

  const sites = await repo.activeSitesForEntity(client, entityId);
  let nearest = null;
  for (const s of sites) {
    const d = haversineMeters(Number(lat), Number(lng), Number(s.latitude), Number(s.longitude));
    if (nearest === null || d < nearest.distance) nearest = { site: s, distance: d };
  }
  if (!nearest) return { work_site_id: null, distance_m: null, within: null, label };
  const within = nearest.distance <= Number(nearest.site.radius_m || 150);
  return { work_site_id: nearest.site.work_site_id, distance_m: Math.round(nearest.distance), within, label };
}

async function resolveEmployee(client, employeeId, actor) {
  const id = employeeId || (actor && actor.user_id ? await repo.employeeIdForUser(client, actor.user_id) : null);
  if (!id) throw new AppError("NO_EMPLOYEE", "No employee is linked to your user — ask HR to link your profile", 422);
  return id;
}

// ── Lateness (manager view). Expected start + grace from hr.attendance_policy. ──
const parseHHMM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
async function attendancePolicy(client) {
  const v = (await getSetting(client, "hr", "attendance_policy", null)) || {};
  return { workStart: parseHHMM(v.work_start) ?? 8 * 60, grace: Number(v.grace_minutes ?? 10) };
}
function lateness(clockInAt, policy) {
  if (!clockInAt) return { is_late: false, minutes_late: 0 };
  const d = new Date(clockInAt);
  const mins = d.getHours() * 60 + d.getMinutes(); // server-local time-of-day (tz caveat)
  const late = mins > policy.workStart + policy.grace;
  return { is_late: late, minutes_late: late ? mins - policy.workStart : 0 };
}

module.exports = {
  ...base,
  resolveGeo,

  /** Attendance log decorated with lateness (manager view). */
  async list(client, q = {}) {
    const rows = await repo.list(client, q);
    const policy = await attendancePolicy(client);
    return rows.map((r) => ({ ...r, ...lateness(r.clock_in_at, policy) }));
  },

  /** Active employees with NO clock-in on a given day (default today). */
  async absence(client, { date = null } = {}) {
    const day = date || new Date().toISOString().slice(0, 10);
    const { rows } = await client.query(
      "SELECT e.employee_id, e.full_name, e.department FROM employee e " +
        "WHERE e.is_active = true AND NOT EXISTS (" +
        "  SELECT 1 FROM attendance_log al WHERE al.employee_id = e.employee_id AND al.clock_in_at::date = $1" +
        ") ORDER BY e.full_name",
      [day],
    );
    return { date: day, count: rows.length, absent: rows };
  },


  /**
   * The caller's currently-open punch (or null). Unlike clock-in/out this never
   * 422s on a non-employee user (e.g. an admin/manager viewing the app): the
   * always-visible clock widget polls this on mount for everyone, so a user with
   * no linked employee simply has "no open punch" rather than an error.
   */
  async open(client, { employeeId = null, actor = {} }) {
    const empId = employeeId || (actor && actor.user_id ? await repo.employeeIdForUser(client, actor.user_id) : null);
    if (!empId) return null;
    return repo.openForEmployee(client, empId);
  },

  /** Clock in: geofenced, one open shift at a time. */
  async clockIn(client, { employeeId = null, latitude = null, longitude = null, accuracy = null, actor = {} }) {
    const empId = await resolveEmployee(client, employeeId, actor);
    await employeeService.assertActive(client, empId);
    if (await repo.openForEmployee(client, empId)) {
      throw new AppError("ALREADY_CLOCKED_IN", "You already have an open shift — clock out first", 409);
    }
    const entityId = await repo.entityForEmployee(client, empId);
    const geo = await resolveGeo(client, { entityId, lat: latitude, lng: longitude });
    const mode = await geofenceMode(client);
    if (mode === "block" && geo.within === false) {
      throw new AppError(
        "OUT_OF_GEOFENCE",
        "You are outside the allowed worksite" + (geo.distance_m !== null && geo.distance_m !== undefined ? ` (${geo.distance_m} m away)` : ""),
        422,
      );
    }
    const row = await repo.insert(client, {
      employee_id: empId,
      clock_in_at: new Date(),
      latitude, longitude, accuracy_m: accuracy,
      work_site_id: geo.work_site_id, distance_m: geo.distance_m,
      within_geofence: geo.within, geo_label: geo.label,
      location: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined ? { lat: latitude, lng: longitude, accuracy } : null,
    });
    const entityRef = `attendance:${row.attendance_id}`;
    await emitEvent(client, { eventTypeKey: events.CLOCKED_IN, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { within_geofence: geo.within, work_site_id: geo.work_site_id } });
    if (geo.within === false) {
      await emitEvent(client, { eventTypeKey: events.OFFSITE, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { distance_m: geo.distance_m } });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CLOCKED_IN, moduleKey: events.MODULE, entityRef, after: row });
    return row;
  },

  /** Clock out the caller's (or a given) open shift, optionally with geo. */
  async clockOut(client, { id = null, employeeId = null, latitude = null, longitude = null, actor = {} }) {
    let before = null;
    if (id) before = await repo.findById(client, id);
    else {
      const empId = await resolveEmployee(client, employeeId, actor);
      before = await repo.openForEmployee(client, empId);
    }
    if (!before) throw new AppError("NO_OPEN_SHIFT", "No open shift to clock out", 404);
    if (before.clock_out_at) throw new AppError("ALREADY_CLOSED", "Attendance already clocked out", 422);

    let outGeo = { within: null, label: null };
    if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
      const entityId = await repo.entityForEmployee(client, before.employee_id);
      const g = await resolveGeo(client, { entityId, lat: latitude, lng: longitude });
      outGeo = { within: g.within, label: g.label };
    }
    const row = await repo.update(client, before.attendance_id, {
      clock_out_at: new Date(),
      out_latitude: latitude, out_longitude: longitude,
      out_within_geofence: outGeo.within, out_geo_label: outGeo.label,
    });
    const entityRef = `attendance:${before.attendance_id}`;
    await emitEvent(client, { eventTypeKey: events.CLOCKED_OUT, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CLOCKED_OUT, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  // ── Worksites (geofence centres) ──
  listSites: (client) => repo.listSites(client),
  async createSite(client, { data, actor = {} }) {
    const row = await repo.insertSite(client, data);
    await emitEvent(client, { eventTypeKey: events.SITE_CHANGED, moduleKey: events.MODULE, entityRef: `work_site:${row.work_site_id}`, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.SITE_CHANGED, moduleKey: events.MODULE, entityRef: `work_site:${row.work_site_id}`, after: row });
    return row;
  },
  async updateSite(client, { id, patch = {}, actor = {} }) {
    const before = await repo.getSite(client, id);
    if (!before) throw new AppError("NOT_FOUND", "Worksite not found", 404);
    const fields = {};
    for (const k of ["name", "latitude", "longitude", "radius_m", "is_active", "entity_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    const row = await repo.updateSite(client, id, fields);
    await audit(client, { actorUserId: actor.user_id || null, action: events.SITE_CHANGED, moduleKey: events.MODULE, entityRef: `work_site:${id}`, before, after: row });
    return row;
  },
};
