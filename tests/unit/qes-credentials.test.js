"use strict";

/**
 * QES credential resolution — the audit finding that one tenant's key
 * answered every other tenant's question in the workers.
 *
 * The old cache key was `${ctx?.tenant || "_"}:${provider}` — read from the
 * AMBIENT request context. Workers have no request context (the poll runs
 * through `registry.withTenantConnection`, which opens a connection and
 * nothing else), so every tenant polled in the same 5-minute window
 * resolved through the shared `"_"` slot: the first tenant's key was the
 * answer for all of them. A tenant that bought its own SignWell account
 * (door 1 — the case §7.2 exists to serve) had its key used to poll other
 * tenants' envelopes, its `credential_source` was wrong on the audit rows,
 * and other tenants' envelopes could not be advanced at all.
 *
 * The fix makes the tenant EXPLICIT: callers name it (the poll already knows
 * its slug), the request path may lean on the ambient context, and a call
 * that names no tenant computes its answer and does not cache it — a slot
 * that cannot identify its tenant is a miss, never a shared seat.
 */

const qes = require("../../src/services/qes");
const settingService = require("../../src/modules/security/setting/setting.service");
const platformSettings = require("../../src/services/platform/settings.service");
const requestContext = require("../../src/config/request-context");

// One client object per tenant — the stand-ins are distinct so the readSecret
// spy can tell them apart, exactly as the real connections do.
const TENANTS = {
  a: { client: {}, key: "KEY_TENANT_A" },
  b: { client: {}, key: "KEY_TENANT_B" },
};

const keyFor = (c) => {
  for (const t of Object.values(TENANTS)) if (c === t.client) return t.key;
  return null;
};

const readSecret = jest
  .spyOn(settingService, "readSecret")
  .mockImplementation(async (c) => keyFor(c));
// No platform account in these tests — door 1 only, so the answer is
// attributable.
jest.spyOn(platformSettings, "resolve").mockResolvedValue(null);

afterEach(() => {
  qes.invalidate();
  jest.clearAllMocks();
  readSecret.mockImplementation(async (c) => keyFor(c));
});

describe("two tenants never share a credential", () => {
  test("tenant A's key answers A; tenant B's key answers B (the P2 regression)", async () => {
    const a = await qes.providerConfig(TENANTS.a.client, "signwell", { tenant: "a" });
    const b = await qes.providerConfig(TENANTS.b.client, "signwell", { tenant: "b" });

    expect(a).toEqual({ apiKey: TENANTS.a.key, source: "tenant" });
    expect(b).toEqual({ apiKey: TENANTS.b.key, source: "tenant" });
  });

  test("the poll pattern — a fleet fanned out together, no request context", async () => {
    // qes-poll-scheduler enqueues the fleet in one burst; each job knows its
    // own slug and has no ambient context. This is the exact sequence the
    // audit measured.
    for (const slug of ["a", "b", "a", "b"]) {
      const cfg = await qes.providerConfig(TENANTS[slug].client, "signwell", { tenant: slug });
      expect(cfg.apiKey).toBe(TENANTS[slug].key);
    }
    // Two tenants, two keys, four reads — one read per tenant, the rest
    // cache hits. The old code read once and served KEY_TENANT_A four times.
    expect(readSecret).toHaveBeenCalledTimes(2);
  });

  test("the ambient request context still names the tenant on the request path", async () => {
    await requestContext.run({ tenant: "a" }, () =>
      qes.providerConfig(TENANTS.a.client, "signwell"));

    // And it shares the slot with the explicit form — same tenant, same key,
    // no double entry.
    const explicit = await qes.providerConfig(TENANTS.a.client, "signwell", { tenant: "a" });
    expect(explicit.apiKey).toBe(TENANTS.a.key);
    expect(readSecret).toHaveBeenCalledTimes(1);
  });
});

describe("a call that cannot name its tenant is a miss, never a shared slot", () => {
  test("no explicit tenant, no ambient context: computed, but not cached", async () => {
    const first = await qes.providerConfig(TENANTS.a.client, "signwell");
    const second = await qes.providerConfig(TENANTS.a.client, "signwell");

    expect(first.apiKey).toBe(TENANTS.a.key);
    expect(second.apiKey).toBe(TENANTS.a.key);
    // The second read happened — nothing was cached to serve it. The cost is
    // a round trip; the alternative is tenant A's key answering tenant B's
    // question, which is not a cost, it is a breach.
    expect(readSecret).toHaveBeenCalledTimes(2);
  });

  test("an explicit tenant beats the ambient context", async () => {
    await requestContext.run({ tenant: "b" }, () =>
      qes.providerConfig(TENANTS.a.client, "signwell", { tenant: "a" }));
    // The answer came from A's client — the explicit name wins, and the
    // entry is filed under "a", not under the ambient "b".
    const underA = await qes.providerConfig(TENANTS.a.client, "signwell", { tenant: "a" });
    expect(underA.apiKey).toBe(TENANTS.a.key);
    expect(readSecret).toHaveBeenCalledTimes(1);
  });
});

describe("the platform door, when the tenant has no key", () => {
  test("a keyless tenant resolves the platform account, named, and cached under its slug", async () => {
    const emptyClient = {};
    readSecret.mockResolvedValueOnce(null);
    platformSettings.resolve.mockResolvedValueOnce({ value: {}, secret: "PLATFORM_KEY" });

    const cfg = await qes.providerConfig(emptyClient, "signwell", { tenant: "empty" });
    expect(cfg).toEqual({ apiKey: "PLATFORM_KEY", source: "platform" });

    // Cached under the tenant's name: a second read for the same tenant does
    // not ask the platform vault again, and a DIFFERENT tenant does not
    // inherit the entry.
    readSecret.mockResolvedValueOnce(null);
    const again = await qes.providerConfig(emptyClient, "signwell", { tenant: "empty" });
    expect(again.apiKey).toBe("PLATFORM_KEY");
    expect(platformSettings.resolve).toHaveBeenCalledTimes(1);
  });
});
