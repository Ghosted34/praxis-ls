"use strict";

jest.mock("../../src/modules/master/corporate_entity/corporate_entity.calendar", () => ({
  get: jest.fn(),
}));

const entityCalendar = require("../../src/modules/master/corporate_entity/corporate_entity.calendar");
const { loadContext, forEmployee } = require("../../src/modules/hr/attendance/attendance.calendar");

describe("loadContext", () => {
  it("reads settings once and serves the entity calendar (or inherited default)", async () => {
    const settings = {
      attendance_policy: { work_start: "07:30", grace_minutes: 5 },
      weekend_days: [0],
      timezone: "Africa/Ndjamena",
    };
    const client = {
      query: async (sql, params) => {
        if (/FROM setting/.test(sql)) {
          const key = params[1];
          return { rows: settings[key] !== undefined ? [{ value: settings[key] }] : [] };
        }
        if (/FROM public_holiday/.test(sql)) {
          return { rows: [{ holiday_on: "2026-05-20", is_recurring: true }] };
        }
        throw new Error(sql);
      },
    };
    entityCalendar.get.mockImplementation(async (_c, id) => ({
      inherited: !id,
      timezone: "Africa/Ndjamena",
      days: [{ weekday: 1, opens_at: "07:30", closes_at: "16:00" }],
      holidays: [],
    }));

    const ctx = await loadContext(client, { entityIds: ["ent-1"] });
    expect(ctx.policyStart).toBe("07:30");
    expect(ctx.policyGrace).toBe(5);
    expect(ctx.weekendDays).toEqual([0]);
    expect(ctx.fallbackTimezone).toBe("Africa/Ndjamena");
    expect(ctx.publicHolidays).toHaveLength(1);
    expect(entityCalendar.get).toHaveBeenCalled();

    const mon = forEmployee(ctx, {
      work_days: null,
      expected_start_time: null,
      grace_minutes: null,
      entity_id: "ent-1",
    }, "2026-08-03");
    expect(mon.isWorkingDay).toBe(true);
    expect(mon.expectedStart).toBe("07:30");
    expect(mon.timezone).toBe("Africa/Ndjamena");
  });
});
