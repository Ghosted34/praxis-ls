/**
 * Working calendar for a corporate entity (MOD-01) — read and save.
 *
 * WHY IT HANGS OFF THE ENTITY. Opening hours and public holidays are a property
 * of the office that does the work, not of the tenant: a Douala branch and an
 * N'Djamena branch keep different hours and observe different days. The
 * milestone engine schedules in WORKING time (0650), so this table is what
 * decides whether "eight hours of customs clearance" lands on Friday afternoon
 * or Monday morning.
 *
 * ONE TENANT-WIDE DEFAULT, seeded at 9090 with `entity_id IS NULL`, is what an
 * entity falls back to until someone gives it its own. `inherited` in the read
 * says which of the two the caller is looking at, so the UI can offer "this
 * entity follows the tenant default" honestly rather than presenting borrowed
 * hours as if they had been chosen.
 *
 * SAVING IS WHOLESALE, not per-row. A calendar is a small, closed set — seven
 * weekdays and a list of dates — and it is edited as one thing. Diffing rows
 * would buy nothing and cost the caller a rebuild of the same payload.
 */
"use strict";

const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-01";

/** The calendar governing an entity: its own if it has one, else the default. */
async function get(client, entityId) {
  const { rows } = await client.query(
    "SELECT * FROM working_calendar " +
      " WHERE is_active AND (entity_id = $1 OR entity_id IS NULL) " +
      " ORDER BY (entity_id IS NOT NULL) DESC, is_default DESC LIMIT 1",
    [entityId],
  );
  const calendar = rows[0];
  if (!calendar) return null;

  const [days, holidays] = await Promise.all([
    client.query(
      "SELECT weekday, opens_at, closes_at FROM working_calendar_day " +
        " WHERE working_calendar_id = $1 ORDER BY weekday",
      [calendar.working_calendar_id],
    ),
    client.query(
      "SELECT working_calendar_holiday_id, holiday_date, is_recurring, name_fr, name_en, is_system " +
        "  FROM working_calendar_holiday WHERE working_calendar_id = $1 " +
        " ORDER BY is_recurring DESC, holiday_date",
      [calendar.working_calendar_id],
    ),
  ]);

  return {
    working_calendar_id: calendar.working_calendar_id,
    entity_id: calendar.entity_id,
    // The whole point of the read: are these THIS entity's hours, or the
    // tenant's, shown because it has none of its own?
    inherited: calendar.entity_id === null,
    name: calendar.name,
    timezone: calendar.timezone,
    days: days.rows,
    holidays: holidays.rows,
  };
}

/**
 * Replace an entity's own calendar.
 *
 * Always writes to the ENTITY's calendar, creating it on first save — editing
 * an inherited calendar must never silently rewrite the tenant default for
 * every other entity that is also inheriting it.
 */
async function save(client, entityId, { timezone, days = [], holidays = [], name, actor = {} }) {
  if (!Array.isArray(days) || days.length === 0) {
    // A calendar with no open day makes every due date unreachable; the engine
    // would fall back and quietly schedule against hours nobody agreed to.
    throw new AppError("NO_WORKING_DAYS", "a working calendar needs at least one open day", 422);
  }

  await client.query("BEGIN");
  try {
    const existing = await client.query(
      "SELECT working_calendar_id FROM working_calendar WHERE entity_id = $1 LIMIT 1",
      [entityId],
    );

    let calendarId = existing.rows[0] && existing.rows[0].working_calendar_id;
    if (calendarId) {
      await client.query(
        "UPDATE working_calendar SET timezone = $2, name = COALESCE($3, name), updated_at = now() " +
          " WHERE working_calendar_id = $1",
        [calendarId, timezone || "Africa/Douala", name || null],
      );
    } else {
      const created = await client.query(
        "INSERT INTO working_calendar (entity_id, name, timezone, is_default, is_active) " +
          " VALUES ($1, $2, $3, false, true) RETURNING working_calendar_id",
        [entityId, name || "Calendrier de travail", timezone || "Africa/Douala"],
      );
      calendarId = created.rows[0].working_calendar_id;
    }

    await client.query("DELETE FROM working_calendar_day WHERE working_calendar_id = $1", [calendarId]);
    for (const d of days) {
      await client.query(
        "INSERT INTO working_calendar_day (working_calendar_id, weekday, opens_at, closes_at) VALUES ($1,$2,$3,$4)",
        [calendarId, d.weekday, d.opens_at, d.closes_at],
      );
    }

    await client.query("DELETE FROM working_calendar_holiday WHERE working_calendar_id = $1", [calendarId]);
    for (const h of holidays) {
      await client.query(
        "INSERT INTO working_calendar_holiday (working_calendar_id, holiday_date, is_recurring, name_fr, name_en, is_system) " +
          " VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (working_calendar_id, holiday_date) DO NOTHING",
        [calendarId, h.holiday_date, !!h.is_recurring, h.name_fr, h.name_en || null, !!h.is_system],
      );
    }

    await emitEvent(client, {
      eventTypeKey: "working_calendar.saved",
      moduleKey: MODULE,
      entityRef: "corporate_entity:" + entityId,
      actorUserId: actor.user_id || null,
      payload: { days: days.length, holidays: holidays.length },
    });
    await audit(client, {
      actorUserId: await resolveActorId(client, actor.user_id),
      action: "working_calendar.saved",
      moduleKey: MODULE,
      entityRef: "corporate_entity:" + entityId,
      after: { timezone, days: days.length, holidays: holidays.length },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  return get(client, entityId);
}

/** Drop an entity's own calendar so it inherits the tenant default again. */
async function reset(client, entityId, { actor = {} } = {}) {
  await client.query("DELETE FROM working_calendar WHERE entity_id = $1", [entityId]);
  await audit(client, {
    actorUserId: await resolveActorId(client, actor.user_id),
    action: "working_calendar.reset",
    moduleKey: MODULE,
    entityRef: "corporate_entity:" + entityId,
  });
  return get(client, entityId);
}

module.exports = { get, save, reset };
