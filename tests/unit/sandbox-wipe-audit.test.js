"use strict";

/**
 * Sandbox wipes must leave a trace — and must only leave one when they happened.
 *
 * WHY THIS EXISTS (2026-08-22 incident). A tenant's sandbox was rebuilt
 * overnight, the data created hours earlier was gone, and nothing anywhere in
 * the platform console could say who or what had done it. `DROP SCHEMA
 * sandbox CASCADE` was the only destructive platform action with no
 * `platform_audit` row, while far smaller acts (changing the wipe interval,
 * toggling a feature) were all recorded.
 *
 * Three defects lined up and each gets a test here:
 *
 *   1. No audit row at all, from any path.
 *   2. `stampSandboxWipe` queried a `pg.Client` it had never connected. pg 8
 *      does not throw on that — `_pulseQueryQueue` returns early while
 *      `readyForQuery` is false, so the promise NEVER SETTLES. The stamp hung,
 *      the worker stalled and retried, and `last_sandbox_wipe_at` stayed NULL —
 *      which the scheduler reads as "never wiped → wipe now". That is the loop
 *      that rebuilt the sandbox nightly instead of every 14 days. The
 *      connect-before-query assertion below is the regression guard, and it is
 *      an ORDERING assertion because a "did we call connect" assertion would
 *      have passed against the broken code in `wipeSandbox`'s sibling.
 *   3. Only the scheduler stamped, so a manual wipe left the window open and
 *      the cron rebuilt the same sandbox again hours later.
 *
 * SEAM: same as tenant-provisioning.test.js — the migrator is mocked and hands
 * back a recording fake client, so the assertions are about the statements the
 * service ISSUED, in order, not about what it returned.
 */

let mockDb;
let mockOps; // ordered { database, op: "connect"|"query"|"end", text? }
let mockFailMigrationFor = new Set();
let mockPlatformInsertFails = false;

const PLATFORM = require("../../src/config/env").config.DB_NAME;

function mockFakeClient(database, opts = {}) {
  return {
    database,
    async connect() {
      mockOps.push({ database, op: "connect", superuser: opts.superuser === true });
    },
    async query(text, params = []) {
      mockOps.push({ database, op: "query", text, params });
      if (
        mockPlatformInsertFails &&
        database === PLATFORM &&
        /INSERT INTO platform\.platform_audit/.test(text)
      ) {
        throw new Error("audit table unreachable");
      }
      const handler = mockDb[database] || (() => []);
      return { rows: handler(text, params) || [] };
    },
    async end() {
      mockOps.push({ database, op: "end" });
    },
  };
}

jest.mock("../../src/services/platform/migrator", () => ({
  files: {
    tenantSchema: () => ["s1.sql"],
    tenantSeeds: () => ["sd1.sql"],
  },
  client: (database, opts) => mockFakeClient(database, opts),
  applyTracked: async (cli) => {
    if (mockFailMigrationFor.has(cli.database))
      throw new Error('relation "sandbox.dossier" does not exist');
    return 1;
  },
  tenantDbName: (slug) => `praxis_${slug}`,
  slugOk: () => true,
  MIGRATIONS: "/migrations",
}));

jest.mock("../../src/shared/db/sandbox-user-mirror", () => ({
  mirrorUsersIntoSandbox: async () => ({ mirrored: 1 }),
  mirrorUserBestEffort: async () => {},
}));

const svc = require("../../src/services/platform/provisioning.service");

const queries = (re, database) =>
  mockOps.filter(
    (o) => o.op === "query" && re.test(o.text) && (!database || o.database === database),
  );
const auditRows = () => queries(/INSERT INTO platform\.platform_audit/);

beforeEach(() => {
  mockOps = [];
  mockFailMigrationFor = new Set();
  mockPlatformInsertFails = false;
  mockDb = {
    [PLATFORM]: (sql) => {
      if (/SELECT tenant_id, sandbox_wipe_days/.test(sql))
        return [
          {
            tenant_id: "t-1",
            sandbox_wipe_days: 14,
            last_sandbox_wipe_at: "2026-08-08T03:30:00.000Z",
          },
        ];
      return [];
    },
    praxis_acme: () => [],
  };
});

describe("sandbox wipe — the audit trail (2026-08-22 incident)", () => {
  it("writes exactly one sandbox.wiped audit row for a successful rebuild", async () => {
    await svc.wipeSandbox({ slug: "acme", source: "console", actorId: "pu-9" });

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/'sandbox\.wiped'/);
    const [actorId, tenantId, entityRef, payload] = rows[0].params;
    expect(actorId).toBe("pu-9");
    expect(tenantId).toBe("t-1");
    expect(entityRef).toBe("acme");
    expect(payload.source).toBe("console");
  });

  it("does NOT claim a wipe that was rolled back", async () => {
    // The whole value of the row is that it describes reality. An audit row for
    // a rebuild that failed and rolled back would send the next investigation
    // in exactly the wrong direction.
    mockFailMigrationFor = new Set(["praxis_acme"]);
    await expect(svc.wipeSandbox({ slug: "acme", source: "console" })).rejects.toThrow(
      /does not exist/,
    );
    expect(auditRows()).toHaveLength(0);
    expect(queries(/SET last_sandbox_wipe_at/)).toHaveLength(0);
  });

  it("records WHO for the console, and that nobody typed it for the scheduler", async () => {
    await svc.wipeSandbox({ slug: "acme", source: "scheduler" });
    const [actorId, , , payload] = auditRows()[0].params;
    expect(actorId).toBeNull();
    expect(payload.source).toBe("scheduler");
  });

  it("falls back to source 'api' rather than trusting an unknown caller label", async () => {
    await svc.wipeSandbox({ slug: "acme", source: "totally-made-up" });
    expect(auditRows()[0].params[3].source).toBe("api");
  });

  it("captures the schedule as it was AT the wipe, before the stamp overwrites it", async () => {
    // `previous_wipe_at: null` is the single most diagnostic value in this
    // payload: it means the scheduler treated the tenant as never-wiped and
    // fired outside its own interval. Reading it after the UPDATE would erase
    // the evidence the row exists to preserve.
    await svc.wipeSandbox({ slug: "acme", source: "scheduler" });
    const payload = auditRows()[0].params[3];
    expect(payload.previous_wipe_at).toBe("2026-08-08T03:30:00.000Z");
    expect(payload.sandbox_wipe_days).toBe(14);
    expect(typeof payload.duration_ms).toBe("number");

    const selectAt = mockOps.findIndex((o) => o.op === "query" && /SELECT tenant_id, sandbox_wipe_days/.test(o.text));
    const stampAt = mockOps.findIndex((o) => o.op === "query" && /SET last_sandbox_wipe_at/.test(o.text));
    expect(selectAt).toBeGreaterThan(-1);
    expect(selectAt).toBeLessThan(stampAt);
  });

  it("stamps last_sandbox_wipe_at on EVERY path, not just the scheduler's", async () => {
    // The old split (worker stamps, console does not) meant a hand-rebuilt
    // sandbox was still 'due' and the cron rebuilt it again the same night.
    await svc.wipeSandbox({ slug: "acme", source: "console", actorId: "pu-9" });
    expect(queries(/UPDATE platform\.tenant SET last_sandbox_wipe_at = now\(\)/)).toHaveLength(1);
  });

  it("connects the platform client BEFORE querying it (the hang that caused the nightly wipe)", async () => {
    await svc.wipeSandbox({ slug: "acme", source: "scheduler" });
    const platformOps = mockOps.filter((o) => o.database === PLATFORM);
    const firstQuery = platformOps.findIndex((o) => o.op === "query");
    const firstConnect = platformOps.findIndex((o) => o.op === "connect");
    expect(firstConnect).toBeGreaterThan(-1);
    expect(firstConnect).toBeLessThan(firstQuery);
  });

  it("stampSandboxWipe connects too — it is still exported and still callable", async () => {
    await svc.stampSandboxWipe({ slug: "acme" });
    const ops = mockOps.filter((o) => o.database === PLATFORM);
    expect(ops[0].op).toBe("connect");
    expect(ops[1].op).toBe("query");
  });

  it("reports audited:false instead of throwing when the audit row cannot be written", async () => {
    // The destructive work is already committed; throwing here would only
    // tempt an operator into re-running a DROP SCHEMA against a sandbox
    // somebody may have re-seeded in the meantime.
    mockPlatformInsertFails = true;
    const out = await svc.wipeSandbox({ slug: "acme", source: "console", actorId: "pu-9" });
    expect(out).toMatchObject({ slug: "acme", source: "console", audited: false });
  });

  it("still drops only the sandbox schema — the audit work changed nothing about that", async () => {
    await svc.wipeSandbox({ slug: "acme", source: "console" });
    expect(queries(/DROP SCHEMA IF EXISTS sandbox CASCADE/, "praxis_acme")).toHaveLength(1);
    expect(queries(/DROP SCHEMA/).every((q) => /sandbox/.test(q.text))).toBe(true);
  });
});
