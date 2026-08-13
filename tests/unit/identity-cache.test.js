"use strict";

/**
 * TC-C4 — `identity-cache.js` had 0 of 31 functions covered.
 *
 * This is the module both other enforcement gates depend on. `rbacCheck` asks
 * it for grants and for the scope closure; `authMiddleware` asks it for the
 * user. A stale or wrongly-keyed answer here is a permission decision made on
 * data that is no longer true — and unlike a crash, it is invisible.
 *
 * THE THREE PROPERTIES THAT MATTER, AND WHY
 *
 *   1. KEYS MUST NOT COLLIDE ACROSS TENANTS. Role ids are per-tenant
 *      gen_random_uuid(), so a collision cannot happen by accident today. The
 *      namespace (PERF S9) is what makes that a guarantee rather than a
 *      coincidence, and what stops one tenant's invalidation flushing everyone.
 *
 *   2. THE SAME ROLE SET MUST PRODUCE THE SAME KEY. Grants are keyed by a role
 *      LIST. If ["a","b"] and ["b","a"] hashed differently the cache would
 *      merely be inefficient — but if duplicates were not collapsed, a user
 *      whose roles are re-saved could miss an invalidation and keep a revoked
 *      grant for the TTL.
 *
 *   3. REDIS BEING DOWN MUST NOT BREAK AUTH. The cache is best-effort by
 *      design. Every path is exercised twice below, once with Redis and once
 *      without, because "auth stops working when Redis blips" is a far worse
 *      failure than a slow request.
 *
 * The fake Redis records commands so the tests can assert that invalidation
 * never issues `KEYS` — that is PERF S9, and a regression to `KEYS` would block
 * the Redis instance that also serves BullMQ, sessions and rate limiting.
 */

const store = new Map();
const commands = [];

const mockFakeRedis = {
  async get(k) {
    commands.push(["GET", k]);
    return store.has(k) ? store.get(k) : null;
  },
  async set(k, v) {
    commands.push(["SET", k]);
    store.set(k, v);
    return "OK";
  },
  async del(...ks) {
    commands.push(["DEL", ks.length]);
    ks.forEach((k) => store.delete(k));
    return ks.length;
  },
  async incr(k) {
    commands.push(["INCR", k]);
    const n = Number(store.get(k) || 0) + 1;
    store.set(k, String(n));
    return n;
  },
  async keys(p) {
    commands.push(["KEYS", p]);
    return [...store.keys()];
  },
  async scan(cursor, _m, pattern, _c, count) {
    commands.push(["SCAN", pattern]);
    const re = new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`,
    );
    const all = [...store.keys()].filter((k) => re.test(k));
    const start = Number(cursor);
    const page = all.slice(start, start + Number(count));
    return [
      start + Number(count) >= all.length ? "0" : String(start + Number(count)),
      page,
    ];
  },
};

let MOCK_REDIS_UP = true;
let mockCTX = { tenant: "smartls" };

jest.mock("../../src/config/redis", () => ({
  getClient: () => {
    if (!MOCK_REDIS_UP) throw new Error("redis not initialised");
    return mockFakeRedis;
  },
}));
jest.mock("../../src/config/request-context", () => ({
  get: () => mockCTX,
  run: (c, fn) => fn(),
}));

let cache;

/** A pg client that counts queries and returns whatever it is told to. */
function makeClient(rows) {
  return {
    count: 0,
    rows,
    async query() {
      this.count += 1;
      return {
        rows: typeof this.rows === "function" ? this.rows() : this.rows,
      };
    },
  };
}

const keysMatching = (frag) =>
  [...store.keys()].filter((k) => k.includes(frag));

describe("identity cache (TC-C4)", () => {
  beforeEach(() => {
    store.clear();
    commands.length = 0;
    MOCK_REDIS_UP = true;
    mockCTX = { tenant: "smartls" };
    jest.resetModules();
    cache = require("../../src/shared/cache/identity-cache");
  });

  describe("getGrants", () => {
    it("reads through to the database on a miss, then serves from cache", async () => {
      const client = makeClient([{ can_read: true }]);
      const first = await cache.getGrants(client, {
        role_ids: ["r1"],
        module: "MOD-35",
      });
      const second = await cache.getGrants(client, {
        role_ids: ["r1"],
        module: "MOD-35",
      });
      expect(first).toEqual([{ can_read: true }]);
      expect(second).toEqual([{ can_read: true }]);
      expect(client.count).toBe(1);
    });

    it("keys the same role set identically whatever the order", async () => {
      const client = makeClient([{ can_read: true }]);
      await cache.getGrants(client, { role_ids: ["b", "a"], module: "MOD-35" });
      await cache.getGrants(client, { role_ids: ["a", "b"], module: "MOD-35" });
      expect(client.count).toBe(1);
    });

    it("collapses duplicate role ids so a re-save cannot orphan a key", async () => {
      const client = makeClient([{ can_read: true }]);
      await cache.getGrants(client, { role_ids: ["a"], module: "MOD-35" });
      await cache.getGrants(client, { role_ids: ["a", "a"], module: "MOD-35" });
      expect(client.count).toBe(1);
    });

    it("keys per module, so a grant on one module is not read for another", async () => {
      const client = makeClient([{ can_read: true }]);
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-67" });
      expect(client.count).toBe(2);
    });

    it("returns empty without touching the database when there are no roles", async () => {
      const client = makeClient([{ can_read: true }]);
      expect(
        await cache.getGrants(client, { role_ids: [], module: "MOD-35" }),
      ).toEqual([]);
      expect(
        await cache.getGrants(client, { role_ids: null, module: "MOD-35" }),
      ).toEqual([]);
      expect(client.count).toBe(0);
    });

    it("still answers correctly with Redis down (best-effort, PERF S9)", async () => {
      MOCK_REDIS_UP = false;
      const client = makeClient([{ can_update: true }]);
      const grants = await cache.getGrants(client, {
        role_ids: ["r1"],
        module: "MOD-35",
      });
      expect(grants).toEqual([{ can_update: true }]);
      // No caching is possible, so every call reads through — slow, not wrong.
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      expect(client.count).toBe(2);
    });
  });

  describe("tenant namespacing (PERF S9)", () => {
    it("gives two tenants separate keys for identical inputs", async () => {
      const client = makeClient([{ can_read: true }]);
      mockCTX = { tenant: "smartls" };
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      mockCTX = { tenant: "acme" };
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      expect(client.count).toBe(2);
      expect(keysMatching(":smartls:grants:")).toHaveLength(1);
      expect(keysMatching(":acme:grants:")).toHaveLength(1);
    });

    it("files work with no tenant context under a reserved namespace", async () => {
      mockCTX = null; // a background job
      const client = makeClient([{ can_read: true }]);
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      expect(keysMatching("identity:_:grants:")).toHaveLength(1);
    });
  });

  describe("invalidateGrants", () => {
    it("clears only the current tenant", async () => {
      const client = makeClient([{ can_read: true }]);
      for (const t of ["smartls", "acme"]) {
        mockCTX = { tenant: t };
        await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      }
      mockCTX = { tenant: "smartls" };
      await cache.invalidateGrants();
      expect(keysMatching(":smartls:grants:")).toHaveLength(0);
      expect(keysMatching(":acme:grants:")).toHaveLength(1);
    });

    it("never issues the blocking KEYS command", async () => {
      const client = makeClient([{ can_read: true }]);
      await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      commands.length = 0;
      await cache.invalidateGrants();
      expect(commands.some((c) => c[0] === "KEYS")).toBe(false);
      expect(commands.some((c) => c[0] === "SCAN")).toBe(true);
    });

    it("clears every tenant only when explicitly asked", async () => {
      const client = makeClient([{ can_read: true }]);
      for (const t of ["smartls", "acme"]) {
        mockCTX = { tenant: t };
        await cache.getGrants(client, { role_ids: ["r1"], module: "MOD-35" });
      }
      await cache.invalidateGrants({ allTenants: true });
      expect(keysMatching(":grants:")).toHaveLength(0);
    });

    it("does not throw when Redis is down", async () => {
      MOCK_REDIS_UP = false;
      await cache.invalidateGrants();
    });
  });

  describe("getUserScopeClosure (PERF S4)", () => {
    it("caches the closure so the recursive CTE does not run per request", async () => {
      const client = makeClient([{ scope_id: "hq" }, { scope_id: "douala" }]);
      for (let i = 0; i < 10; i += 1)
        await cache.getUserScopeClosure(client, "u1");
      expect(client.count).toBe(1);
    });

    it("caches per user", async () => {
      const client = makeClient([{ scope_id: "hq" }]);
      await cache.getUserScopeClosure(client, "u1");
      await cache.getUserScopeClosure(client, "u2");
      expect(client.count).toBe(2);
    });

    it("retires every cached closure when the tree changes", async () => {
      let tree = [{ scope_id: "hq" }];
      const client = makeClient(() => tree);
      expect(await cache.getUserScopeClosure(client, "u1")).toEqual(["hq"]);

      tree = [{ scope_id: "hq" }, { scope_id: "bafoussam" }]; // a re-parent
      expect(await cache.getUserScopeClosure(client, "u1")).toEqual(["hq"]); // still cached

      await cache.bumpScopeVersion();
      expect(await cache.getUserScopeClosure(client, "u1")).toEqual([
        "hq",
        "bafoussam",
      ]);
    });

    it("invalidates the whole tree in ONE command, not one per user", async () => {
      const client = makeClient([{ scope_id: "hq" }]);
      for (const u of ["u1", "u2", "u3", "u4"])
        await cache.getUserScopeClosure(client, u);
      commands.length = 0;
      await cache.bumpScopeVersion();
      expect(commands).toHaveLength(1);
      expect(commands[0][0]).toBe("INCR");
    });

    it("does not bump another tenant's tree", async () => {
      const client = makeClient([{ scope_id: "hq" }]);
      mockCTX = { tenant: "acme" };
      await cache.getUserScopeClosure(client, "u1");
      const acmeKeys = keysMatching(":acme:scope:closure:");
      mockCTX = { tenant: "smartls" };
      await cache.bumpScopeVersion();
      expect(keysMatching(":acme:scope:closure:")).toEqual(acmeKeys);
    });

    it("returns empty for no user without querying", async () => {
      const client = makeClient([{ scope_id: "hq" }]);
      expect(await cache.getUserScopeClosure(client, null)).toEqual([]);
      expect(client.count).toBe(0);
    });

    it("still resolves with Redis down", async () => {
      MOCK_REDIS_UP = false;
      const client = makeClient([{ scope_id: "hq" }]);
      expect(await cache.getUserScopeClosure(client, "u1")).toEqual(["hq"]);
    });
  });

  describe("invalidateUser", () => {
    it("drops the caller's auth, scope and capability entries", async () => {
      const client = makeClient([{ user_id: "u1", status: "ACTIVE" }]);
      await cache.getAuthUser(client, "u1");
      expect(keysMatching(":auth:u1")).toHaveLength(1);
      await cache.invalidateUser("u1");
      expect(keysMatching(":auth:u1")).toHaveLength(0);
    });

    it("does not throw when Redis is down", async () => {
      MOCK_REDIS_UP = false;
      await cache.invalidateUser("u1");
    });
  });

  describe("getAuthUser", () => {
    it("caches the projection and serves it on the next request", async () => {
      const client = makeClient([
        { user_id: "u1", status: "ACTIVE", role_ids: [] },
      ]);
      await cache.getAuthUser(client, "u1");
      await cache.getAuthUser(client, "u1");
      expect(client.count).toBe(1);
    });

    it("returns null for an unknown user without caching a wrong answer", async () => {
      const client = makeClient([]);
      expect(await cache.getAuthUser(client, "nobody")).toBeNull();
    });
  });
});
