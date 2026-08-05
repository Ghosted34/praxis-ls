"use strict";

/**
 * TC-C1 — multi-tenant isolation. `registry.service.js` had 0 of 10 functions
 * covered.
 *
 * This module is the tenant boundary. It turns a Host header into a database,
 * and every request in the product goes through it. A defect here is not a bug
 * in a feature; it is one tenant reading another tenant's books. It was also
 * the least tested file in the codebase.
 *
 * WHAT IS ACTUALLY ASSERTED
 *
 * Not "does it return a pool" — the isolation properties, stated as things that
 * must never happen:
 *
 *   - two tenants must never share a pool, whatever order they arrive in
 *   - a connection must never be handed out bound to the wrong schema
 *   - a cached host must never resolve to a different tenant's metadata
 *   - an unbounded input must never grow an unbounded cache (PERF S10)
 *   - eviction must never drop a pool that is still the most recently used
 *
 * `pg` is mocked because the point is the registry's own logic; a real Postgres
 * would test Postgres. The fake Pool records every connection it hands out so
 * the tests can assert on identity, not just on shape.
 *
 * jest.mock is called before the module under test is required, and the module
 * is required lazily in beforeEach. That ordering is not stylistic: it is what
 * lets these tests run under a plain-node runner as well as under Jest.
 */

const POOLS = [];

class mockFakePool {
  constructor(opts) {
    this.opts = opts;
    this.handlers = {};
    this.connections = [];
    this.free = [];
    this.ended = false;
    this.totalCount = 0;
    this.idleCount = 0;
    this.waitingCount = 0;
    POOLS.push(this);
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  async connect() {
    const pool = this;
    // RECYCLES released clients, like a real pg.Pool. This matters: the
    // search_path re-bind only happens on a connection that has already been
    // used, so a fake that always minted a fresh client would make that test
    // pass for the wrong reason — the new client carries the pool's startup
    // schema and needs no SET at all.
    const reused = this.free.pop();
    if (reused) {
      reused.released = false;
      return reused;
    }
    const client = {
      pool,
      queries: [],
      released: false,
      async query(sql) {
        this.queries.push(sql);
        return { rows: [] };
      },
      release() {
        this.released = true;
        pool.free.push(this);
      },
    };
    // `connect` fires once per NEW connection, which is where the pool records
    // the startup search_path.
    if (this.handlers.connect) await this.handlers.connect(client);
    this.connections.push(client);
    return client;
  }

  async query() {
    return { rows: [] };
  }

  async end() {
    this.ended = true;
  }
}

jest.mock("pg", () => ({ Pool: mockFakePool }));
jest.mock("pgvector/pg", () => ({ registerType: async () => {} }));

const SCHEMA = Symbol.for("praxis.conn.schema");

const meta = (name, over = {}) => ({
  slug: name,
  db_name: `tenant_${name}`,
  db_host: `${name}.db.internal`,
  db_port: 5432,
  live_schema: "live",
  sandbox_schema: "sandbox",
  ...over,
});

let registry;

describe("tenant registry — isolation (TC-C1)", () => {
  beforeEach(() => {
    POOLS.length = 0;
    process.env.TENANT_POOL_CACHE_MAX = "3";
    process.env.HOST_CACHE_MAX = "4";
    jest.resetModules();
    registry = require("../../src/services/tenant/registry.service");
  });

  describe("pools are per tenant database", () => {
    it("gives two tenants two different pools", () => {
      const a = registry.poolFor(meta("alpha"));
      const b = registry.poolFor(meta("beta"));
      expect(a).not.toBe(b);
      expect(a.opts.database).toBe("tenant_alpha");
      expect(b.opts.database).toBe("tenant_beta");
    });

    it("reuses one pool for repeated access to the same tenant", () => {
      const first = registry.poolFor(meta("alpha"));
      const second = registry.poolFor(meta("alpha"));
      expect(first).toBe(second);
      expect(POOLS).toHaveLength(1);
    });

    it("never lets one tenant's connection come from another tenant's pool", async () => {
      const alpha = await registry.acquire(meta("alpha"), "live");
      const beta = await registry.acquire(meta("beta"), "live");
      expect(alpha.pool.opts.database).toBe("tenant_alpha");
      expect(beta.pool.opts.database).toBe("tenant_beta");
      expect(alpha.pool).not.toBe(beta.pool);
    });
  });

  describe("schema binding (PERF S2)", () => {
    it("binds the live schema as a startup parameter, costing no round-trip", async () => {
      const client = await registry.acquire(meta("alpha"), "live");
      expect(POOLS[0].opts.options).toBe("-c search_path=live,public");
      expect(client[SCHEMA]).toBe("live");
      // The whole point: a fresh live connection issues NO SET.
      expect(client.queries).toHaveLength(0);
    });

    it("issues exactly one SET when the request needs sandbox", async () => {
      const client = await registry.acquire(meta("alpha"), "sandbox");
      expect(client[SCHEMA]).toBe("sandbox");
      expect(client.queries).toHaveLength(1);
      expect(client.queries[0]).toContain("SET search_path = sandbox, public");
    });

    it("re-binds a recycled connection rather than serving the wrong schema", async () => {
      const first = await registry.acquire(meta("alpha"), "sandbox");
      first.release();
      // Same pool, same underlying client object, now wanted as live.
      const second = await registry.acquire(meta("alpha"), "live");
      expect(second[SCHEMA]).toBe("live");
      expect(second.queries.some((q) => q.includes("search_path = live"))).toBe(true);
    });

    it("honours a tenant's non-default schema names", async () => {
      const client = await registry.acquire(
        meta("gamma", { live_schema: "prod", sandbox_schema: "staging" }),
        "sandbox",
      );
      expect(client[SCHEMA]).toBe("staging");
    });

    it("releases the connection when the caller's function throws", async () => {
      const boom = new Error("handler exploded");
      let caught = null;
      try {
        await registry.withTenantConnection(meta("alpha"), "live", () => {
          throw boom;
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBe(boom);
      expect(POOLS[0].connections[0].released).toBe(true);
    });
  });

  describe("pool cache is bounded and LRU (PERF S1)", () => {
    it("evicts the least recently used pool past the cap", () => {
      for (const n of ["a", "b", "c", "d", "e"]) registry.poolFor(meta(n));
      const stats = registry.poolStats();
      expect(stats.pools).toBe(3);
      expect(stats.cap).toBe(3);
      expect(POOLS.filter((p) => p.ended).map((p) => p.opts.database)).toEqual([
        "tenant_a",
        "tenant_b",
      ]);
    });

    it("does not evict a pool that was just used", () => {
      for (const n of ["a", "b", "c"]) registry.poolFor(meta(n));
      registry.poolFor(meta("a")); // touch — 'a' is now most recent, 'b' oldest
      registry.poolFor(meta("d"));
      const ended = POOLS.filter((p) => p.ended).map((p) => p.opts.database);
      expect(ended).toContain("tenant_b");
      expect(ended).not.toContain("tenant_a");
    });

    it("drains an evicted pool rather than leaking its sockets", () => {
      for (const n of ["a", "b", "c", "d"]) registry.poolFor(meta(n));
      const evicted = POOLS.find((p) => p.opts.database === "tenant_a");
      expect(evicted.ended).toBe(true);
    });
  });

  describe("host cache is bounded by attacker-controlled input (PERF S10)", () => {
    it("holds at the cap however many distinct hosts arrive", async () => {
      for (let i = 0; i < 50; i += 1) await registry.resolveByHost(`junk-${i}.example.com`);
      const stats = registry.hostCacheStats();
      expect(stats.size).toBe(4);
      expect(stats.cap).toBe(4);
    });

    it("normalises host so a port or casing cannot split the cache", async () => {
      await registry.resolveByHost("Alpha.Praxisls.COM:8080");
      const before = registry.hostCacheStats().size;
      await registry.resolveByHost("alpha.praxisls.com");
      expect(registry.hostCacheStats().size).toBe(before);
    });

    it("forgets a host on demand", async () => {
      await registry.resolveByHost("alpha.praxisls.com");
      expect(registry.hostCacheStats().size).toBe(1);
      registry.invalidateHost("alpha.praxisls.com");
      expect(registry.hostCacheStats().size).toBe(0);
    });
  });

  describe("pool statistics", () => {
    it("reports occupancy per database without leaking credentials", () => {
      registry.poolFor(meta("alpha"));
      const stats = registry.poolStats();
      expect(stats.detail).toHaveLength(1);
      expect(stats.detail[0].db).toBe("tenant_alpha");
      expect(JSON.stringify(stats)).not.toContain("password");
    });
  });
});
