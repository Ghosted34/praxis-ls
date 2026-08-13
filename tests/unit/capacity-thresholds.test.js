"use strict";
jest.mock("../../src/services/platform/db", () => ({ query: jest.fn(), opsQuery: jest.fn() }));
jest.mock("../../src/services/tenant/registry.service", () => ({ poolStats: jest.fn(), listActiveTenants: jest.fn(), withTenantConnection: jest.fn() }));
jest.mock("../../src/services/tenant/pooler-stats.service", () => ({ pools: jest.fn() }));
jest.mock("../../src/services/platform/provisioning.service", () => ({ fleetSchemaStatus: jest.fn() }));
jest.mock("../../src/services/platform/runtime-config.service", () => ({ opsTuning: jest.fn() }));
const health = require("../../src/services/platform/health-rollup.service");

const at = (pct, thresholds) => health.statusFor({ pool_utilisation_pct: pct }, thresholds);

describe("capacity thresholds default at the call site", () => {
  test("nothing configured anywhere → 80% default applies", () => {
    expect(at(79, {}).status).toBe("GREEN");
    expect(at(80, {}).status).toBe("AMBER");
  });
  test("a vault row of 0 does NOT make every tenant amber", () => {
    expect(at(5, { healthPoolUtilisationAmber: 0 }).status).toBe("GREEN");
  });
  test("a garbage value falls back to the default rather than never firing", () => {
    expect(at(85, { healthPoolUtilisationAmber: "eighty" }).status).toBe("AMBER");
    expect(at(50, { healthPoolUtilisationAmber: "eighty" }).status).toBe("GREEN");
  });
  test("a real override is honoured", () => {
    expect(at(65, { healthPoolUtilisationAmber: 60 }).status).toBe("AMBER");
  });
  test("pooler maxwait: 0 in the vault does not amber a healthy pooler", () => {
    expect(health.statusFor({ pooler_maxwait_us: 1000 }, { healthPoolerMaxwaitAmberMs: 0 }).status).toBe("GREEN");
  });
  test("absent capacity signals are simply not judged", () => {
    expect(health.statusFor({}, {}).status).toBe("GREEN");
  });
});
