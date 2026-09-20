"use strict";

const mockEmitted = [];
const mockAudited = [];

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async (_client, event) => mockEmitted.push(event)),
  audit: jest.fn(async (_client, entry) => mockAudited.push(entry)),
  resolveActorId: jest.fn(async (_client, userId) => userId || null),
}));

const { reset } = require("../../src/modules/master/corporate_entity/corporate_entity.calendar");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A small transactional tenant-db double. It models the calendar tables and
 * cascading child deletes, rather than merely asserting SQL strings. That lets
 * these tests exercise the rollback contract without requiring Postgres.
 */
function calendarDb({ own, fallback, failOn } = {}) {
  const state = {
    calendars: clone([own, fallback].filter(Boolean)),
    days: clone([...(own && own.days ? own.days : []), ...(fallback && fallback.days ? fallback.days : [])]),
    holidays: clone([...(own && own.holidays ? own.holidays : []), ...(fallback && fallback.holidays ? fallback.holidays : [])]),
  };
  const calls = [];
  let transactionState;

  const client = {
    calls,
    state,
    async query(sql, params = []) {
      calls.push(sql);
      if (failOn && sql.includes(failOn)) throw new Error("injected calendar failure");
      if (sql === "BEGIN") {
        transactionState = clone(state);
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        Object.assign(state, clone(transactionState));
        return { rows: [] };
      }
      if (sql === "COMMIT") return { rows: [] };
      // The per-entity advisory lock save()/reset() take to serialise
      // concurrent writers (PR-10 / B.4). Postgres answers it with an empty
      // row; so does the double.
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (sql.startsWith("DELETE FROM working_calendar WHERE entity_id")) {
        const deleted = state.calendars.filter((row) => row.entity_id === params[0]).map((row) => row.working_calendar_id);
        state.calendars = state.calendars.filter((row) => row.entity_id !== params[0]);
        state.days = state.days.filter((row) => !deleted.includes(row.working_calendar_id));
        state.holidays = state.holidays.filter((row) => !deleted.includes(row.working_calendar_id));
        return { rows: [] };
      }
      if (sql.startsWith("SELECT * FROM working_calendar")) {
        const candidates = state.calendars
          .filter((row) => row.is_active && (row.entity_id === params[0] || row.entity_id === null))
          .sort((a, b) => Number(b.entity_id !== null) - Number(a.entity_id !== null));
        return { rows: candidates.slice(0, 1).map(({ days: _days, holidays: _holidays, ...row }) => row) };
      }
      if (sql.startsWith("SELECT weekday")) {
        return { rows: state.days.filter((row) => row.working_calendar_id === params[0]) };
      }
      if (sql.startsWith("SELECT working_calendar_holiday_id")) {
        return { rows: state.holidays.filter((row) => row.working_calendar_id === params[0]) };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return client;
}

const ownCalendar = {
  working_calendar_id: "own-1",
  entity_id: "entity-1",
  name: "Douala own",
  timezone: "Africa/Douala",
  is_active: true,
  is_default: false,
  days: [{ working_calendar_id: "own-1", weekday: 1, opens_at: "07:30", closes_at: "17:00" }],
  holidays: [
    {
      working_calendar_id: "own-1",
      working_calendar_holiday_id: "holiday-1",
      holiday_date: "2026-12-25",
      is_recurring: false,
      name_fr: "Noël",
      name_en: "Christmas",
      is_system: true,
    },
  ],
};

const defaultCalendar = {
  working_calendar_id: "default-1",
  entity_id: null,
  name: "Tenant default",
  timezone: "Africa/Lagos",
  is_active: true,
  is_default: true,
  days: [{ working_calendar_id: "default-1", weekday: 1, opens_at: "08:00", closes_at: "16:00" }],
  holidays: [],
};

afterEach(() => {
  mockEmitted.length = 0;
  mockAudited.length = 0;
});

describe("corporate entity working-calendar reset", () => {
  it("atomically restores the inherited timezone and holiday source and audits before/after", async () => {
    const client = calendarDb({ own: ownCalendar, fallback: defaultCalendar });

    const result = await reset(client, "entity-1", { actor: { user_id: "user-1" } });

    expect(result).toMatchObject({
      entity_id: null,
      inherited: true,
      timezone: "Africa/Lagos",
      holidays: [],
    });
    expect(client.state.calendars).toEqual([expect.objectContaining({ working_calendar_id: "default-1" })]);
    expect(mockEmitted).toHaveLength(1);
    expect(mockEmitted[0]).toMatchObject({
      eventTypeKey: "working_calendar.reset",
      entityRef: "corporate_entity:entity-1",
      actorUserId: "user-1",
    });
    expect(mockAudited).toHaveLength(1);
    expect(mockAudited[0].before).toMatchObject({
      entity_id: "entity-1",
      timezone: "Africa/Douala",
      holidays: [expect.objectContaining({ holiday_date: "2026-12-25" })],
    });
    expect(mockAudited[0].after).toMatchObject({ entity_id: null, timezone: "Africa/Lagos" });
    expect(client.calls[0]).toBe("BEGIN");
    expect(client.calls.at(-1)).toBe("COMMIT");
  });

  it("rolls back the delete when event/audit processing fails", async () => {
    const client = calendarDb({ own: ownCalendar, fallback: defaultCalendar });
    const { emitEvent } = require("../../src/shared/events/emit");
    emitEvent.mockRejectedValueOnce(new Error("event store unavailable"));

    await expect(reset(client, "entity-1")).rejects.toThrow("event store unavailable");

    expect(client.state.calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ working_calendar_id: "own-1", entity_id: "entity-1" }),
    ]));
    expect(client.calls.at(-1)).toBe("ROLLBACK");
    expect(client.calls).not.toContain("COMMIT");
  });

  it("is safe to reset an already inherited entity and still records the no-op transition", async () => {
    const client = calendarDb({ fallback: defaultCalendar });

    const result = await reset(client, "entity-1");

    expect(result.inherited).toBe(true);
    expect(mockAudited[0].before).toEqual(mockAudited[0].after);
    expect(mockEmitted[0].payload.before).toEqual(mockEmitted[0].payload.after);
  });
});
