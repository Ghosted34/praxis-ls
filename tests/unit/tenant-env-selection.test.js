/**
 * Which schema a request works in — `envFor`, shared by HTTP
 * (middleware/tenant-context) and the realtime socket, so the two can never
 * disagree about where a page is.
 *
 * 2026-09-29: TEST keeps working after a tenant goes live. It used to be
 * switched off by `is_live`, silently: the client never learns that flag, so the
 * TEST chip stayed on while every request behind it read and wrote LIVE.
 */
"use strict";

const { envFor } = require("../../src/middleware/tenant-context");

describe("envFor", () => {
  const live = { slug: "acme", is_live: true };
  const onboarding = { slug: "acme", is_live: false };

  test.each([
    ["a live tenant asking for sandbox", live, "sandbox", "sandbox"],
    ["an onboarding tenant asking for sandbox", onboarding, "sandbox", "sandbox"],
    ["any case of the header", live, "SandBox", "sandbox"],
  ])("%s → sandbox", (_label, tenant, header, want) => {
    expect(envFor(tenant, header)).toBe(want);
  });

  test.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["an explicit live", "live"],
    ["an unrecognised value", "production"],
    ["a near miss", "sandbox2"],
  ])("%s → live, the default", (_label, header) => {
    expect(envFor(live, header)).toBe("live");
    expect(envFor(onboarding, header)).toBe("live");
  });

  test("no tenant is never sandbox", () => {
    expect(envFor(null, "sandbox")).toBe("live");
  });
});
