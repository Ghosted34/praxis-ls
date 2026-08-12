"use strict";
/**
 * Scheduling policy resolution (MOD-31).
 *
 * The policy decides two things a client feels directly: whether finishing
 * early moves the date they were promised, and what happens when an SLA can no
 * longer be met. Both are configurable per tenant AND per service type, because
 * the right answer differs — a sea import holds its delivery date and shouts;
 * a warehousing retainer would rather re-plan.
 *
 * Three layers, and the ORDER is the whole test: engine defaults, then the
 * tenant's setting, then this service type's override. Get the precedence
 * backwards and a tenant's careful per-service configuration is silently
 * ignored, which is invisible until someone asks why a date moved.
 */
const service = require("../../src/modules/operations/milestone/milestone.service");
const { DEFAULT_POLICY } = require("../../src/modules/operations/milestone/milestone.schedule");

/** A client that returns one `setting` row — the only query resolvePolicy makes. */
const clientWith = (value) => ({
  query: async () => ({ rows: value === undefined ? [] : [{ value }] }),
});

const SVC = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("resolvePolicy", () => {
  it("falls back to the engine defaults when nothing is configured", async () => {
    const p = await service.resolvePolicy(clientWith(undefined));
    expect(p).toEqual(DEFAULT_POLICY);
  });

  it("lets the tenant setting override the engine defaults", async () => {
    const p = await service.resolvePolicy(clientWith({ earlyCompletion: "PULL_ALWAYS", riskHours: 8 }));
    expect(p.earlyCompletion).toBe("PULL_ALWAYS");
    expect(p.riskHours).toBe(8);
    // Untouched keys still come from the defaults rather than becoming undefined.
    expect(p.onFloorReached).toBe(DEFAULT_POLICY.onFloorReached);
  });

  it("lets a service-type override win over the tenant setting", async () => {
    const stored = {
      earlyCompletion: "HOLD",
      onFloorReached: "HOLD_AND_ALERT",
      by_service: { [SVC]: { onFloorReached: "REQUIRE_REPLAN" } },
    };
    const p = await service.resolvePolicy(clientWith(stored), SVC);
    expect(p.onFloorReached).toBe("REQUIRE_REPLAN");
    // …and only the keys the override names; the rest still come from the tenant.
    expect(p.earlyCompletion).toBe("HOLD");
  });

  it("leaves other service types on the tenant policy", async () => {
    const stored = {
      onFloorReached: "HOLD_AND_ALERT",
      by_service: { [SVC]: { onFloorReached: "AUTO_RELEASE" } },
    };
    expect((await service.resolvePolicy(clientWith(stored), OTHER)).onFloorReached).toBe("HOLD_AND_ALERT");
    expect((await service.resolvePolicy(clientWith(stored))).onFloorReached).toBe("HOLD_AND_ALERT");
  });

  it("never leaks the override map into the resolved policy", async () => {
    // `by_service` is storage, not a scheduling knob — the scheduler spreads
    // this object straight into its own options.
    const p = await service.resolvePolicy(clientWith({ by_service: { [SVC]: {} } }), SVC);
    expect(p.by_service).toBeUndefined();
  });

  it("ignores a malformed setting rather than failing every schedule", async () => {
    for (const bad of ["nonsense", 42, null]) {
      expect(await service.resolvePolicy(clientWith(bad))).toEqual(DEFAULT_POLICY);
    }
  });
});
