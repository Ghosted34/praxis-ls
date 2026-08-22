"use strict";

const {
  timezones,
  common,
  entityCommon,
  partyCommon,
} = require("@praxis/shared");

describe("canonical timezone reference", () => {
  test("contains every IANA geographic zone plus UTC without duplicates", () => {
    expect(timezones.TZDB_VERSION).toBe("2026b");
    expect(timezones.CATALOGUE).toHaveLength(419);
    expect(new Set(timezones.CATALOGUE.map((zone) => zone.id)).size).toBe(419);

    for (const id of [
      "UTC",
      "Africa/Douala",
      "America/New_York",
      "Antarctica/McMurdo",
      "Asia/Kathmandu",
      "Atlantic/Azores",
      "Australia/Eucla",
      "Europe/Kyiv",
      "Indian/Maldives",
      "Pacific/Chatham",
    ]) {
      expect(timezones.byId(id)).toMatchObject({ id });
    }
  });

  test("normalises backwards-compatible IANA links", () => {
    expect(timezones.normalize("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(timezones.normalize("US/Eastern")).toBe("America/New_York");
    expect(timezones.normalize("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(timezones.normalize("Zulu")).toBe("UTC");
  });

  test("the shared boundary rejects arbitrary free text", () => {
    expect(common.ianaTimezone.parse("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(() => common.ianaTimezone.parse("Mars/Olympus")).toThrow(
      "Choose a timezone from the list.",
    );

    expect(
      entityCommon.workingCalendarSave.safeParse({
        timezone: "Not/A_Zone",
        days: [{ weekday: 1, opens_at: "08:00", closes_at: "17:00" }],
      }).success,
    ).toBe(false);
    expect(
      partyCommon.contactCreate.safeParse({
        name: "Ada",
        timezone: "Africa/Douala",
      }).success,
    ).toBe(true);
  });
});
