"use strict";
const { addBusinessMinutes } = require("../../src/modules/mail/triage/sla-clock");

const hours = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, opens_at: "08:00", closes_at: "17:00" }));

describe("SLA business hours", () => {
  test("Friday 16:30 + 4 business hours skips the weekend", () => {
    const fri = new Date("2026-08-14T16:30:00"); // Friday
    const due = addBusinessMinutes(fri, 240, { hours, holidays: [] });
    expect(due.getDay()).toBe(1); // Monday
    expect(due.getHours()).toBeGreaterThanOrEqual(8);
    expect(due.getHours()).toBeLessThan(17);
  });

  test("a holiday is skipped", () => {
    const thu = new Date("2026-12-24T16:30:00");
    const due = addBusinessMinutes(thu, 60, { hours, holidays: [{ holiday_on: "2026-12-25" }] });
    expect(due.toISOString().slice(0, 10)).not.toBe("2026-12-25");
  });
});
