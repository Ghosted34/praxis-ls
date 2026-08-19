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
const { logger } = require("../../../config/logger");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const repo = require("./attendance.repo");
const events = require("./attendance.events");
// 0704: the lateness query, raised at the punch and adopted by the reconciler.
const hrQuery = require("./attendance.query");
const employeeService = require("../../master/employees/employees.service");
const geoapify = require("../../../services/geoapify.service");
const rules = require("./attendance.rules");
const reconcile = require("./attendance.reconcile");
const { locationStatus, locationSourceFromFix } = require("./attendance.location");

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
 * off | warn | block, DEFAULT OFF — and the difference from the geofence
 * default is deliberate.
 *
 * A tenant that upgrades into this migration has no registered devices, by
 * definition. Defaulting to `warn` would mark every punch in the company
 * untrusted on day one, which trains everybody to ignore the flag before it
 * has ever meant anything. Defaulting to `block` would stop the clock outright.
 * Off means nothing changes until an administrator turns it on, having first
 * let people register.
 */
async function devicePolicy(client) {
  const v = await getSetting(client, "hr", "device_policy", "off");
  const mode = typeof v === "string" ? v : (v && v.mode) || "off";
  return ["off", "warn", "block"].includes(mode) ? mode : "off";
}

/**
 * A DISTINGUISHABLE name for a device nobody has named yet.
 *
 * "Windows · Chrome" was the first attempt and it is useless: it names a browser
 * category, not a machine, so every Windows laptop in the company produces the
 * identical string. A manager looking at two rows that both say "Windows ·
 * Chrome" cannot do the one thing this register exists for — tell them apart —
 * and a second device appearing, which is the whole signal, becomes invisible.
 *
 * The fingerprint's first four characters fix that. They are not meaningful and
 * are not meant to be read as meaningful; they are a discriminator, so two rows
 * are never the same string and a human can say "approve the 7f3a one". Short
 * enough not to look like a secret, and it is not one — the value is already
 * opaque and already stored.
 *
 * This is still only a PLACEHOLDER. The real name comes from a person: the
 * employee or the manager renaming it to "Faith's laptop" or "Yard tablet",
 * which is why `label` is patchable and why the upsert never overwrites it.
 */
function deviceLabelFrom(userAgent, fingerprint) {
  const ua = String(userAgent || "");
  const os =
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad|iPod/i.test(ua) ? "iOS" :
    /Windows/i.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/i.test(ua) ? "Mac" :
    /Linux/i.test(ua) ? "Linux" : null;
  const browser =
    // Order matters: Edge and Opera both claim Chrome, Chrome claims Safari.
    /Edg\//i.test(ua) ? "Edge" :
    /OPR\/|Opera/i.test(ua) ? "Opera" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) ? "Safari" : null;
  // The discriminator is the only part that is actually per-device, so it is
  // never dropped — an unrecognised user agent still yields a unique label.
  const tag = String(fingerprint || "").replace(/[^a-z0-9]/gi, "").slice(0, 4).toLowerCase();
  return [os, browser].filter(Boolean).concat(tag || []).join(" · ") || "Unrecognised device";
}

/**
 * Resolve the device presented with a punch against the register + the policy.
 *
 * Returns { device, trusted, blocked, reason }. `trusted` is null when no
 * device was presented at all (an older client, or the policy is off) — the
 * same three-valued convention `within_geofence` uses, and for the same reason:
 * "we did not check" must not be recorded as "we checked and it failed".
 */
async function resolveDevice(client, { employeeId, device }) {
  const mode = await devicePolicy(client);
  const fingerprint = device && typeof device.fingerprint === "string" ? device.fingerprint.trim() : "";

  if (!fingerprint) {
    // Under `block`, a client that sends nothing must not sail through — that
    // is the whole point of the setting, and "my app is old" is not a defence
    // an attendance policy can accept.
    if (mode === "block") {
      return { device: null, trusted: null, blocked: true, reason: "This device isn't registered — register it before clocking in" };
    }
    return { device: null, trusted: null, blocked: false, reason: null };
  }

  /*
   * RECORDING IS NOT ENFORCEMENT, and the two must not share a switch.
   *
   * This used to return early when the policy was `off`, so no device was ever
   * written. The consequence was a trap of the setting's own making: the
   * register could only fill while enforcement was on, and enforcement could
   * only be turned on safely once the register had filled. An administrator who
   * left the default in place saw an empty Devices panel forever and had no
   * path to `warn` that did not begin by flagging every punch in the company.
   *
   * So the row is written at EVERY policy. `off` means "do not judge", not "do
   * not look" — the register builds passively, and turning enforcement on later
   * is then a decision made against real data instead of a leap.
   */
  const row = await repo.upsertDevice(client, {
    employeeId,
    fingerprint,
    label: (device.label && String(device.label).trim()) || deviceLabelFrom(device.user_agent, fingerprint),
    userAgent: device.user_agent || null,
    platform: device.platform || null,
  });

  // Three-valued, like `within_geofence`. Under `off` we recorded WHICH device
  // this was but formed no opinion about it, and writing `false` there would
  // paint every historic punch "Unapproved" the moment somebody enables the
  // policy — the retrospective flag the snapshot column exists to prevent.
  if (mode === "off") return { device: row, trusted: null, blocked: false, reason: null, isNew: row.inserted === true };

  const trusted = row.status === "TRUSTED";
  if (mode === "block" && !trusted) {
    return {
      device: row,
      trusted,
      isNew: row.inserted === true,
      blocked: true,
      reason: row.status === "REVOKED"
        ? "This device has been blocked for clocking in — speak to HR"
        : "This device is waiting for approval before it can clock you in",
    };
  }
  return { device: row, trusted, blocked: false, reason: null, isNew: row.inserted === true };
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
/** The active LATENESS rule, or null. Same selection the reconciler makes
 *  (first by code, so the choice is stable) — the punch and the settlement must
 *  cite the same clause or the employee is told two different things. */
async function latenessRule(client) {
  const { rows } = await client.query(
    "SELECT * FROM hr_rule WHERE kind = 'LATENESS' AND is_active ORDER BY code LIMIT 1",
  );
  return rows[0] || null;
}

async function attendancePolicy(client) {
  const v = (await getSetting(client, "hr", "attendance_policy", null)) || {};
  return {
    workStart: parseHHMM(v.work_start) ?? 8 * 60,
    startText: typeof v.work_start === "string" && v.work_start ? v.work_start : "08:00",
    grace: Number(v.grace_minutes ?? 10),
    timeZone: await reconcile.timezoneOf(client),
  };
}
/**
 * Lateness for the admin log.
 *
 * The "(tz caveat)" that used to be on this function was a bug, not a caveat:
 * it read `new Date(clockInAt).getHours()`, i.e. the SERVER's clock. On a UTC
 * host — every container we deploy — a Cameroonian employee (UTC+1) arriving at
 * 08:30 read as 07:30 and was half an hour EARLY against an 08:00 start. Nobody
 * was ever late. `attendance.rules` reads the wall clock in the tenant's own
 * timezone; this is now a thin call onto the same code the reconciler uses, so
 * the log and the charged day can never disagree.
 */
function lateness(clockInAt, policy) {
  if (!clockInAt) return { is_late: false, minutes_late: 0 };
  const minutes = rules.minutesLate({
    clock_in_at: clockInAt,
    expected_start_time: policy.startText,
    grace_minutes: policy.grace,
    timeZone: policy.timeZone,
  });
  return { is_late: minutes > 0, minutes_late: minutes };
}

module.exports = {
  ...base,
  resolveGeo,

  /** Attendance log decorated with lateness + location_status (manager view). */
  async list(client, q = {}) {
    const policy = await attendancePolicy(client);
    const rows = await repo.list(client, { ...q, timeZone: policy.timeZone });
    return rows.map((r) => ({
      ...r,
      ...lateness(r.clock_in_at, policy),
      location_status: locationStatus(r),
    }));
  },

  /**
   * Who was actually absent on a day.
   *
   * ── WHAT THIS USED TO REPORT ─────────────────────────────────────────────
   *
   * "Every active employee with no clock-in." That counted as absent: everybody
   * on approved leave, everybody whose shift does not include that weekday,
   * everybody on a public holiday, and — because it defaulted to TODAY —
   * everybody who simply had not arrived yet at the time the page was opened.
   * A manager checking absences at 08:30 saw most of the company.
   *
   * It now reads the reconciled day (0697), where those cases are distinct
   * states rather than the same missing row. `attendance_log.clock_in_at::date`
   * is gone with it: that compared a UTC date to a local one, so a punch after
   * 23:00 Douala counted for the following day.
   *
   * ── AND WHEN A DAY HAS NOT BEEN RECONCILED YET ───────────────────────────
   *
   * The reconciler runs on completed days, so TODAY has no rows. Rather than
   * report a quiet, wrong zero, this says so — `reconciled: false` — and falls
   * back to the raw "no punch yet" list, labelled as provisional. A screen can
   * then tell the truth instead of implying the day is settled.
   */
  async absence(client, { date = null } = {}) {
    const day = date || new Date().toISOString().slice(0, 10);
    const { rows } = await client.query(
      `SELECT d.employee_id, e.full_name, e.department, d.status, d.minutes_late,
              d.deduction_amount, d.justified
         FROM attendance_day d
         JOIN employee e ON e.employee_id = d.employee_id
        WHERE d.work_date = $1 AND d.status = 'ABSENT'
        ORDER BY e.full_name`,
      [day],
    );
    const { rows: any } = await client.query("SELECT 1 FROM attendance_day WHERE work_date = $1 LIMIT 1", [day]);
    if (any[0]) return { date: day, reconciled: true, count: rows.length, absent: rows };

    const tz = (await attendancePolicy(client)).timeZone;
    const { rows: provisional } = await client.query(
      `SELECT e.employee_id, e.full_name, e.department
         FROM employee e
        WHERE e.is_active = true
          AND NOT EXISTS (SELECT 1 FROM attendance_log al
                           WHERE al.employee_id = e.employee_id
                             AND al.clock_in_at >= ($1::timestamp AT TIME ZONE $2)
                             AND al.clock_in_at <  (($1::date + 1)::timestamp AT TIME ZONE $2))
          AND NOT EXISTS (SELECT 1 FROM leave_request lr
                           WHERE lr.employee_id = e.employee_id
                             AND lr.status IN ('APPROVED','TAKEN')
                             AND lr.starts_on <= $1::date AND lr.ends_on >= $1::date)
        ORDER BY e.full_name`,
      [day, tz],
    );
    return { date: day, reconciled: false, count: provisional.length, absent: provisional };
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

  /** Clock in: geofenced, device-checked, one open shift at a time. */
  async clockIn(client, { employeeId = null, latitude = null, longitude = null, accuracy = null, device = null, actor = {} }) {
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
    /*
     * The device is resolved BEFORE the refusal below, not after, and that
     * ordering is the point: an unapproved device that is turned away must
     * still be ON THE REGISTER, dated, for the manager who has to decide about
     * it. Refusing first would mean the only devices anyone could ever see are
     * the ones that were already allowed — the register would list exactly the
     * rows nobody needed to look at.
     */
    const dev = await resolveDevice(client, { employeeId: empId, device });
    if (dev.blocked) throw new AppError("DEVICE_NOT_REGISTERED", dev.reason, 422);
    /*
     * `repo.create`, not `repo.insert`.
     *
     * The factory in shared/crud/resource.js exposes `create` (line 149) and has
     * never exposed `insert`, so this line threw `repo.insert is not a function`
     * on EVERY clock-in — the endpoint had never once worked. It surfaced today
     * only because the punch moved into the title bar: while it was buried in a
     * dropdown on desktop and a `md:hidden` FAB on touch, nobody pressed it.
     *
     * Worth stating plainly, because a "no traffic" endpoint and a "no such
     * function" endpoint look identical in the error dashboard until somebody
     * makes the button visible.
     */
    const hasFix = latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined;
    const row = await repo.create(client, {
      employee_id: empId,
      clock_in_at: new Date(),
      latitude, longitude, accuracy_m: accuracy,
      work_site_id: geo.work_site_id, distance_m: geo.distance_m,
      within_geofence: geo.within, geo_label: geo.label,
      location_source: hasFix ? "gps" : "none",
      hr_device_id: dev.device ? dev.device.hr_device_id : null,
      device_trusted: dev.trusted,
      location: hasFix ? { lat: latitude, lng: longitude, accuracy } : null,
    });
    const entityRef = `attendance:${row.attendance_id}`;
    await emitEvent(client, { eventTypeKey: events.CLOCKED_IN, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { within_geofence: geo.within, work_site_id: geo.work_site_id } });
    if (geo.within === false) {
      await emitEvent(client, { eventTypeKey: events.OFFSITE, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { distance_m: geo.distance_m } });
    }
    // A punch from a device nobody has approved is the signal this table exists
    // to raise — under `warn` it is accepted, so the event is the ONLY trace a
    // manager gets in the moment.
    // `=== false`, not `!dev.trusted`. Under the `off` policy `trusted` is null
    // — recorded but not judged — and the loose test would raise this alert on
    // every punch in a workspace that has deliberately not switched enforcement
    // on. An alert that fires when nobody asked for it is one nobody reads.
    if (dev.device && dev.trusted === false) {
      await emitEvent(client, {
        eventTypeKey: events.UNTRUSTED_DEVICE, moduleKey: events.MODULE, entityRef,
        actorUserId: actor.user_id || null,
        payload: { hr_device_id: dev.device.hr_device_id, status: dev.device.status },
      });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CLOCKED_IN, moduleKey: events.MODULE, entityRef, after: row });

    /*
     * ASK THEM NOW (0704).
     *
     * The auto-query used to be raised by the nightly reconciler, so somebody
     * ninety minutes late on Tuesday was asked about it on Wednesday — when the
     * true answer has to be recalled rather than given, and the manager who
     * watched them arrive has moved on.
     *
     * Three things about the shape of this:
     *
     *   It NEVER fails the punch. Clocking in is how somebody gets paid, and a
     *   missing rule, a missing policy or a database hiccup in the query path
     *   must not be the reason they cannot start work. Caught, logged, ignored.
     *
     *   The deduction is stated as a PROSPECT, not a fact — the day is not over
     *   and leave, a correction or a waiver can still change it. `composeQuery`
     *   handles that with `settled: false`.
     *
     *   The row it writes is the SAME row the reconciler will adopt tonight,
     *   keyed on (employee, work_date, rule). Without that the employee gets
     *   asked twice about one late morning.
     */
    const policy = await attendancePolicy(client);
    const late = lateness(row.clock_in_at, policy);
    if (late.is_late) {
      try {
        const rule = await latenessRule(client);
        if (rule && rule.auto_query) {
          await hrQuery.upsertAutoQuery(client, {
            employeeId: empId,
            workDate: rules.localDate(row.clock_in_at, policy.timeZone),
            rule,
            source: "CLOCK_IN",
            minutesLate: late.minutes_late,
            expectedStart: policy.startText,
            // Not computed here: the daily rate depends on the month's working
            // days and the reconciler owns that arithmetic. Quoting a figure
            // the settlement might not match is worse than quoting none.
            deduction: 0,
            settled: false,
            attendanceId: row.attendance_id,
            actorId: await resolveActorId(client, actor.user_id),
          });
        }
      } catch (err) {
        logger.warn({ err, employee: empId }, "[attendance] could not raise the clock-in query — the punch stands");
      }
    }

    /*
     * `device_new` is TRANSIENT — not a column, and deliberately not one.
     *
     * It answers one question, once: "has this person just clocked in from a
     * device nobody has named?" The clock uses it to offer a naming prompt on
     * that punch alone. Storing it would mean a row that is permanently "new",
     * and every later reader would have to know it meant "was new, then".
     */
    return { ...row, device_new: dev.isNew === true, location_status: locationStatus({ ...row, location_source }) };
  },

  /**
   * Rename YOUR OWN device.
   *
   * Separate from `setDeviceStatus` because the permissions are genuinely
   * different, not as a convenience. Deciding a device is TRUSTED is a manager's
   * call and sits behind MOD-14 `edit`; calling your own phone "my phone" is not,
   * and gating it the same way would mean the only person who knows what the
   * device actually is cannot say so. This is gated on `create` — the grant that
   * already lets them punch.
   *
   * It can therefore ONLY set the label, and ONLY on a row belonging to the
   * caller's own employee record. A 404 rather than a 403 for somebody else's
   * device: whether a given device id exists is not a question this endpoint
   * should answer.
   */
  async renameOwnDevice(client, { id, label, actor = {} }) {
    const empId = await resolveEmployee(client, null, actor);
    const before = await repo.getDevice(client, id);
    if (!before || before.employee_id !== empId) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }
    const row = await repo.updateDevice(client, id, { label: String(label).trim() });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DEVICE_CHANGED, moduleKey: events.MODULE, entityRef: `hr_device:${id}`, before, after: row });
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

  /**
   * Candidate places for the worksite form — "where is the Douala yard?"
   *
   * WHY THIS EXISTS RATHER THAN REUSING /geo-places/search. That endpoint is
   * gated on MOD-29 + the `operations` feature, because it writes into the ports
   * catalogue every dossier and the Control Tower map inherit. An HR admin
   * defining a geofence has neither grant and should not need them: they are
   * placing ONE pin on ONE worksite row, not adding reference data. So this is a
   * read-only pass-through to the provider gated on MOD-14 edit — the same grant
   * that creates the worksite the coordinate is for. Nothing is persisted here.
   *
   * Never throws: `searchPlaces` returns a { status, results } taxonomy so the
   * form can distinguish "no such place" from "nobody configured a provider key",
   * which are different problems with different owners.
   */
  searchPlaces: (q, { country = null, limit = 6 } = {}) =>
    geoapify.searchPlaces(q, { limit, countryCodes: country ? [country] : null }),

  // ── Registered devices (0524) ──
  listDevices: (client, q = {}) => repo.listDevices(client, { employeeId: q.employee_id || null }),

  /**
   * Register the caller's current device, without punching.
   *
   * The clock registers on first use anyway, so this exists for the case that
   * would otherwise have no route: a tenant on `block`, where the first punch
   * from a new device is refused and the employee needs SOMETHING that puts the
   * row in front of a manager. Idempotent — the same device twice is one row.
   */
  async registerDevice(client, { employeeId = null, device = {}, actor = {} }) {
    const empId = await resolveEmployee(client, employeeId, actor);
    const fingerprint = String(device.fingerprint || "").trim();
    if (!fingerprint) throw new AppError("NO_FINGERPRINT", "This browser didn't provide a device id", 422);
    const row = await repo.upsertDevice(client, {
      employeeId: empId,
      fingerprint,
      label: (device.label && String(device.label).trim()) || deviceLabelFrom(device.user_agent, fingerprint),
      userAgent: device.user_agent || null,
      platform: device.platform || null,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DEVICE_CHANGED, moduleKey: events.MODULE, entityRef: `hr_device:${row.hr_device_id}`, after: row });
    return row;
  },

  /**
   * Approve, revoke or rename a device.
   *
   * REVOKED IS TERMINAL, and the check is here rather than in the validator
   * because it is a rule about the record's history, not about the shape of the
   * request. Un-revoking silently would let a device that a manager blocked
   * come back as merely "pending" and then be waved through by whoever handles
   * the queue next, with nothing on screen saying it had been blocked before.
   * Re-admitting a blocked device should mean deleting it and registering it
   * again, deliberately.
   */
  async setDeviceStatus(client, { id, patch = {}, actor = {} }) {
    const before = await repo.getDevice(client, id);
    if (!before) throw new AppError("NOT_FOUND", "Device not found", 404);
    const fields = {};
    if (patch.label !== undefined) fields.label = String(patch.label).trim();
    if (patch.status !== undefined) {
      if (before.status === "REVOKED" && patch.status !== "REVOKED") {
        throw new AppError("DEVICE_REVOKED", "This device was blocked. Remove it and register it again rather than re-approving it.", 422);
      }
      fields.status = patch.status;
    }
    const row = await repo.updateDevice(client, id, fields);
    await emitEvent(client, { eventTypeKey: events.DEVICE_CHANGED, moduleKey: events.MODULE, entityRef: `hr_device:${id}`, actorUserId: actor.user_id || null, payload: { status: row.status } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DEVICE_CHANGED, moduleKey: events.MODULE, entityRef: `hr_device:${id}`, before, after: row });
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
