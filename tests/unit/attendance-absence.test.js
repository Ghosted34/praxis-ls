"use strict";

const service = require("../../src/modules/hr/attendance/attendance.service");

describe("absence provisional window", () => {
  it("uses AT TIME ZONE, never clock_in_at::date", async () => {
    const sqls = [];
    const client = {
      query: async (sql, params) => {
        sqls.push({ sql: String(sql), params });
        if (/FROM attendance_day d/.test(sql)) return { rows: [] };
        if (/FROM attendance_day WHERE work_date/.test(sql)) return { rows: [] };
        if (/FROM setting/.test(sql)) return { rows: [{ value: "Africa/Douala" }] };
        if (/FROM employee e/.test(sql)) return { rows: [] };
        throw new Error("unhandled: " + sql.slice(0, 80));
      },
    };
    const out = await service.absence(client, { date: "2026-08-18" });
    expect(out.reconciled).toBe(false);
    const prov = sqls.find((c) => /NOT EXISTS \(SELECT 1 FROM attendance_log/.test(c.sql));
    expect(prov).toBeTruthy();
    expect(prov.sql).toMatch(/AT TIME ZONE/);
    expect(prov.sql).not.toMatch(/clock_in_at::date/);
    expect(prov.params).toEqual(["2026-08-18", "Africa/Douala"]);
  });
});
