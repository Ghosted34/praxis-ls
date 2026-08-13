"use strict";

/**
 * TC-C9 — the platform / tenant-provisioning surface at 0%.
 *
 * This is the code that creates a tenant's database, migrates the fleet on
 * every deploy, projects the feature entitlements, rebuilds a sandbox and
 * bootstraps the first administrator. It runs from `scripts/deploy.sh` against
 * every tenant on every environment, and nothing tested any of it.
 *
 * Three of its behaviours are fixes for findings that were themselves never
 * covered, which is the worst combination — a fix nobody can prove still works:
 *
 *   - DATA 3.2 / TEST-D3: the fleet migration used to abort on the first
 *     failing tenant, splitting the estate at an arbitrary point with nothing
 *     recorded about where the line fell, DURING a deploy, while the new image
 *     rolled out to all of them. It now continues, enumerates, and throws after.
 *   - The `depends_on` projection: `citext[]` comes back from node-postgres as a
 *     RAW STRING, and iterating it character by character once turned EVERY
 *     feature off because "{" is not a feature key. That is the "19 modules were
 *     dark" bug.
 *   - SEC H6: `createAdmin` mints the CEO account, which bypasses every
 *     permission check in the product, and was guarded by zod's min(8).
 *
 * SEAM: everything reaches Postgres through `migrator.client()`, so the migrator
 * is mocked and hands back a recording fake client. Every SQL string the service
 * issues is captured, which is what lets the ordering and containment assertions
 * be about what it DID rather than what it returned. argon2 and the password
 * policy stay real — they are the subject of the SEC H6 assertions.
 */

const argon2 = require("argon2");

// No unit test may reach the network; password-policy calls HIBP and fails open.
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network disabled in unit tests");
};

// ── the world these tests run against ────────────────────────────────────────

let mockDb; // name -> { rows(sql, params) => rows }
let mockEnsured = []; // databases ensureDatabase was asked to create
let mockApplied = []; // { scope, searchPath, files }
let mockOpened = []; // { database, superuser }
let mockClosed = 0;
let mockFailMigrationFor = new Set(); // slug -> migrateTenantDb throws
let mockUnreachable = new Set(); // dbName -> connect() throws

/** A recording fake pg Client. Unmatched SQL returns no rows, but every
 *  statement is captured, so "the query was never issued" is detectable — the
 *  failure mode TC-Q3 flags in the older regex fakes. */
function mockFakeClient(database, opts = {}) {
  const handler = mockDb[database] || (() => []);
  return {
    database,
    sql: [],
    async connect() {
      mockOpened.push({ database, superuser: opts.superuser === true });
      if (mockUnreachable.has(database))
        throw new Error(`could not connect to ${database}`);
    },
    async query(text, params = []) {
      this.sql.push({ text, params });
      mockAllSql.push({ database, text, params });
      return { rows: handler(text, params) || [] };
    },
    async end() {
      mockClosed += 1;
    },
  };
}

let mockAllSql = [];
const sqlMatching = (re) => mockAllSql.filter((s) => re.test(s.text));

jest.mock("../../src/services/platform/migrator", () => ({
  files: {
    platform: () => ["p1.sql"],
    platformSeeds: () => ["ps1.sql"],
    tenantBootstrap: () => ["b1.sql"],
    tenantSchema: () => ["s1.sql", "s2.sql", "s3.sql"],
    tenantSeeds: () => ["sd1.sql"],
  },
  client: (database, opts) => mockFakeClient(database, opts),
  ensureDatabase: async (name) => {
    mockEnsured.push(name);
  },
  ensureLedger: async () => {},
  appliedSet: async () => new Set(),
  applyTracked: async (cli, files, opts) => {
    if (mockFailMigrationFor.has(cli.database))
      throw new Error('relation "live.dossier" does not exist');
    mockApplied.push({
      database: cli.database,
      scope: opts.scope,
      searchPath: opts.searchPath || null,
      files: files.length,
    });
    return files.length;
  },
  applyFiles: async () => 0,
  slugOk: (s) => /^[a-z][a-z0-9_]*$/.test(String(s || "")),
  tenantDbName: (slug) => `praxis_${slug}`,
  MIGRATIONS: "/migrations",
}));

let mockMirrored = [];
let mockMirrorFails = false;
jest.mock("../../src/shared/db/sandbox-user-mirror", () => ({
  mirrorUsersIntoSandbox: async (cli, opts) => {
    if (mockMirrorFails) throw new Error("sandbox mirror exploded");
    mockMirrored.push({
      database: cli.database,
      userId: opts ? opts.userId : null,
    });
    return { mirrored: 1 };
  },
  mirrorUserBestEffort: async () => {},
}));

const svc = require("../../src/services/platform/provisioning.service");

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

/** Default platform responses: one plan, one tenant, an empty catalogue. */
function platformDb({ slugs = ["acme"], plan = true, features = [] } = {}) {
  return (sql) => {
    if (/FROM platform\.plan WHERE code/.test(sql))
      return plan ? [{ plan_id: "plan-1" }] : [];
    if (/INSERT INTO platform\.tenant \(/.test(sql))
      return [{ tenant_id: "t-1" }];
    if (/SELECT slug FROM platform\.tenant/.test(sql))
      return slugs.map((s) => ({ slug: s }));
    if (/SELECT tenant_id FROM platform\.tenant/.test(sql))
      return [{ tenant_id: "t-1" }];
    if (/FROM platform\.tenant t JOIN platform\.feature_catalogue/.test(sql))
      return features;
    return [];
  };
}

describe("tenant provisioning (TC-C9)", () => {
  beforeEach(() => {
    mockDb = { praxis_platform: platformDb() };
    mockEnsured = [];
    mockApplied = [];
    mockOpened = [];
    mockAllSql = [];
    mockMirrored = [];
    mockClosed = 0;
    mockFailMigrationFor = new Set();
    mockUnreachable = new Set();
    mockMirrorFails = false;
    fetchCalls = 0;
  });

  // The platform database name comes from config; bind it once so the fixtures
  // above and the service agree without hard-coding it in twelve places.
  const { config } = require("../../src/config/env");
  beforeEach(() => {
    mockDb[config.DB_NAME] = platformDb();
  });

  describe("depends_on parsing — the citext[] trap", () => {
    it("parses a real array", () => {
      expect(svc.toDepsArray(["a", "b"])).toEqual(["a", "b"]);
    });

    it("parses the RAW POSTGRES LITERAL node-postgres actually returns", () => {
      // citext[] has no array parser registered in node-postgres, so the driver
      // hands back the literal as a string. A naive `for..of` over "{a,b}"
      // iterates CHARACTERS, and "{" is not a feature key — which turned every
      // feature off, including features with no dependencies at all.
      expect(svc.toDepsArray("{a,b}")).toEqual(["a", "b"]);
      expect(svc.toDepsArray("{ai.assistant}")).toEqual(["ai.assistant"]);
      expect(svc.toDepsArray('{"quoted.key","other"}')).toEqual([
        "quoted.key",
        "other",
      ]);
    });

    it("treats the empty literal as no dependencies, not as one blank one", () => {
      // The precise shape of the bug: "{}" must yield [], never ["{", "}"] or [""].
      expect(svc.toDepsArray("{}")).toEqual([]);
      expect(svc.toDepsArray("{ }")).toEqual([]);
      expect(svc.toDepsArray(null)).toEqual([]);
      expect(svc.toDepsArray(undefined)).toEqual([]);
    });
  });

  describe("feature dependency enforcement", () => {
    const f = (key, state, deps) => ({
      feature_key: key,
      state,
      source: "plan",
      depends_on: deps,
    });

    it("leaves an independent feature alone", () => {
      const out = svc.enforceDependencies([
        f("a", "on", "{}"),
        f("b", "on", []),
      ]);
      expect(out.map((x) => x.state)).toEqual(["on", "on"]);
    });

    it("forces a child off when its parent is off", () => {
      const out = svc.enforceDependencies([
        f("parent", "off", []),
        f("child", "on", ["parent"]),
      ]);
      expect(out.find((x) => x.feature_key === "child").state).toBe("off");
    });

    it("cascades to a fixpoint through a chain", () => {
      // A→B→C with C off. One pass would only catch B; the loop must run until
      // nothing changes or A is left entitled with its grandparent dark.
      const out = svc.enforceDependencies([
        f("a", "on", ["b"]),
        f("b", "on", ["c"]),
        f("c", "off", []),
      ]);
      expect(out.map((x) => x.state)).toEqual(["off", "off", "off"]);
    });

    it("cascades regardless of the order the rows arrive in", () => {
      // The SQL has no ORDER BY, so leaf-first must behave like root-first.
      const out = svc.enforceDependencies([
        f("c", "off", []),
        f("a", "on", ["b"]),
        f("b", "on", ["c"]),
      ]);
      expect(out.every((x) => x.state === "off")).toBe(true);
    });

    it("treats a dependency that is not in the catalogue as unmet", () => {
      // An unknown key cannot be satisfied, so the safe resolution is off.
      const out = svc.enforceDependencies([f("child", "on", ["ghost"])]);
      expect(out[0].state).toBe("off");
    });

    it("preserves source while flipping state", () => {
      // tenant feature_state.source has a CHECK allowing only
      // plan|override|default, so the reason cannot be smuggled in there.
      const out = svc.enforceDependencies([
        f("parent", "off", []),
        f("child", "on", ["parent"]),
      ]);
      expect(out.find((x) => x.feature_key === "child").source).toBe("plan");
    });

    it("does not turn on a feature that was already off", () => {
      const out = svc.enforceDependencies([
        f("parent", "on", []),
        f("child", "off", ["parent"]),
      ]);
      expect(out.find((x) => x.feature_key === "child").state).toBe("off");
    });

    it("terminates on a dependency cycle, leaving the cycle ON", () => {
      // The fixpoint loop is `while (changed)`; a cycle must settle rather than
      // spin, and it does — each member sees the other still 'on', nothing
      // changes, the loop exits on the first pass.
      //
      // The RESOLUTION is the surprising part and is recorded here rather than
      // asserted as correct: a→b→a leaves BOTH on, even though a cyclic
      // dependency can never be genuinely rooted in anything. Every other unmet
      // dependency resolves to off. This is unreachable from the current
      // catalogue (no cycles in it) and is not a finding I am claiming — but if
      // someone adds one, this test is where the behaviour is written down.
      const out = svc.enforceDependencies([
        f("a", "on", ["b"]),
        f("b", "on", ["a"]),
      ]);
      expect(out.map((x) => x.state)).toEqual(["on", "on"]);
    });

    it("forces a cycle off when nothing in it is rooted", () => {
      // The reachable version of the above: the cycle hangs off a dead parent.
      const out = svc.enforceDependencies([
        f("a", "on", ["b"]),
        f("b", "on", ["a", "root"]),
        f("root", "off", []),
      ]);
      expect(out.every((x) => x.state === "off")).toBe(true);
    });
  });

  describe("projectFeatures", () => {
    it("writes the resolved state into BOTH schemas", () => {
      // A feature that is on in live and absent in sandbox makes TEST mode
      // behave differently from LIVE for no visible reason.
      mockDb[config.DB_NAME] = platformDb({
        features: [
          {
            feature_key: "ai.assistant",
            depends_on: "{}",
            state: "on",
            source: "plan",
          },
        ],
      });
      return svc.projectFeatures("acme").then((out) => {
        expect(out).toEqual({ projected: 1 });
        const writes = sqlMatching(/INSERT INTO (live|sandbox)\.feature_state/);
        expect(writes).toHaveLength(2);
        expect(writes.some((w) => /INSERT INTO live\./.test(w.text))).toBe(
          true,
        );
        expect(writes.some((w) => /INSERT INTO sandbox\./.test(w.text))).toBe(
          true,
        );
      });
    });

    it("projects a dependency-blocked feature as off in both schemas", () => {
      mockDb[config.DB_NAME] = platformDb({
        features: [
          {
            feature_key: "ai.assistant",
            depends_on: "{}",
            state: "off",
            source: "plan",
          },
          {
            feature_key: "ai.assistant.backend",
            depends_on: "{ai.assistant}",
            state: "on",
            source: "plan",
          },
        ],
      });
      return svc.projectFeatures("acme").then(() => {
        const backend = sqlMatching(/INSERT INTO live\.feature_state/).find(
          (w) => w.params[0] === "ai.assistant.backend",
        );
        expect(backend.params[1]).toBe("off");
        expect(backend.params[2]).toBe("plan");
      });
    });

    it("casts depends_on to text[] in the query it issues", () => {
      // Belt to toDepsArray's braces. If this cast is dropped the driver goes
      // back to returning the raw literal, and the only thing standing between
      // that and 19 dark modules is the fallback parser.
      return svc.projectFeatures("acme").then(() => {
        const read = sqlMatching(
          /FROM platform\.tenant t JOIN platform\.feature_catalogue/,
        );
        expect(read).toHaveLength(1);
        expect(read[0].text).toMatch(/depends_on::text\[\]/);
      });
    });
  });

  describe("provisionTenant", () => {
    it("rejects a slug that is not a safe identifier", async () => {
      // The slug becomes a DATABASE NAME and is interpolated into schema-qualified
      // DDL. This is the only thing standing between input and that.
      for (const bad of ["Acme", "9acme", "acme-corp", "acme;drop", ""]) {
        const err = await rejection(
          svc.provisionTenant({ slug: bad, name: "Acme" }),
        );
        expect(err.message).toMatch(/invalid slug/);
      }
      expect(mockEnsured).toHaveLength(0);
    });

    it("requires a name", async () => {
      const err = await rejection(svc.provisionTenant({ slug: "acme" }));
      expect(err.message).toMatch(/name is required/);
    });

    it("refuses an unknown plan before flipping the tenant live", async () => {
      mockDb[config.DB_NAME] = platformDb({ plan: false });
      const err = await rejection(
        svc.provisionTenant({ slug: "acme", name: "Acme", plan: "nope" }),
      );
      expect(err.message).toMatch(/unknown plan/);
      expect(
        sqlMatching(/UPDATE platform\.tenant SET status='LIVE'/),
      ).toHaveLength(0);
    });

    it("creates the database and migrates it before recording the tenant", async () => {
      // Ordering matters: a tenant row that says LIVE against a database that
      // does not exist yet is a tenant the router will send traffic to.
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      expect(mockEnsured).toEqual(["praxis_acme"]);
      const migratedAt = mockApplied.findIndex(
        (a) => a.database === "praxis_acme",
      );
      expect(migratedAt).toBeGreaterThanOrEqual(0);
      const tenantRowAt = mockAllSql.findIndex((s) =>
        /INSERT INTO platform\.tenant \(/.test(s.text),
      );
      expect(tenantRowAt).toBeGreaterThanOrEqual(0);
    });

    it("migrates live AND sandbox, schema and seeds", async () => {
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      const scopes = mockApplied
        .filter((a) => a.database === "praxis_acme")
        .map((a) => a.scope);
      expect(scopes).toEqual([
        "db",
        "live",
        "live-seed",
        "sandbox",
        "sandbox-seed",
      ]);
      const live = mockApplied.find((a) => a.scope === "live");
      expect(live.searchPath).toBe("live,public");
      const sandbox = mockApplied.find((a) => a.scope === "sandbox");
      expect(sandbox.searchPath).toBe("sandbox,public");
    });

    it("ends PROVISIONING at LIVE and writes the audit trail", async () => {
      const out = await svc.provisionTenant({
        slug: "acme",
        name: "Acme Ltd",
        actorId: "op-1",
      });
      expect(out).toMatchObject({
        slug: "acme",
        dbName: "praxis_acme",
        tenantId: "t-1",
      });

      const insert = sqlMatching(/INSERT INTO platform\.tenant \(/)[0];
      expect(insert.text).toMatch(/'PROVISIONING'/);
      expect(
        sqlMatching(/UPDATE platform\.tenant SET status='LIVE'/),
      ).toHaveLength(1);

      const audit = sqlMatching(/INSERT INTO platform\.platform_audit/);
      expect(audit).toHaveLength(1);
      expect(audit[0].params[0]).toBe("op-1");
      expect(audit[0].params[2]).toBe("tenant.provisioned");
    });

    it("derives the host from the slug and registers it", async () => {
      const out = await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      expect(out.host).toBe(`acme.${config.APP_BASE_DOMAIN}`);
      const sub = sqlMatching(/INSERT INTO platform\.subdomain/)[0];
      expect(sub.params[1]).toBe(out.host);
    });

    it("honours an explicit subdomain", async () => {
      const out = await svc.provisionTenant({
        slug: "acme",
        name: "Acme Ltd",
        subdomain: "portal.acme.example",
      });
      expect(out.host).toBe("portal.acme.example");
    });

    it("seeds the display name without clobbering a tenant's own edit", async () => {
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      const seeds = sqlMatching(/INSERT INTO (live|sandbox)\.setting/);
      expect(seeds).toHaveLength(2);
      for (const s of seeds) {
        expect(s.text).toMatch(/ON CONFLICT \(section, key\) DO NOTHING/);
        expect(s.params[0]).toBe("Acme Ltd");
      }
    });

    it("never stores a database password in the platform row", async () => {
      // secret_ref is a POINTER. A literal password here would put tenant
      // credentials in the platform database in the clear.
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      const dbRow = sqlMatching(/INSERT INTO platform\.tenant_database/)[0];
      expect(dbRow.params[5]).toBe("vault:tenant/acme/db-password");
      expect(dbRow.text).not.toMatch(/password\s*\)/i);
    });

    it("closes every connection it opens", async () => {
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      expect(mockClosed).toBe(mockOpened.length);
    });

    it("wraps the five platform writes in ONE transaction (DI-5.6)", async () => {
      // tenant upsert, tenant_database, subdomain, status='LIVE', audit. Each
      // used to autocommit on its own, so a failure part-way left a tenant that
      // looked half-real: registered with no subdomain, or stuck in
      // PROVISIONING with its schema fully built and nothing routing to it.
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      const platformSql = mockAllSql.filter(
        (s) => s.database === config.DB_NAME,
      );
      expect(platformSql.filter((s) => /^\s*BEGIN/i.test(s.text))).toHaveLength(
        1,
      );
      expect(
        platformSql.filter((s) => /^\s*COMMIT/i.test(s.text)),
      ).toHaveLength(1);

      const beginAt = platformSql.findIndex((s) => /^\s*BEGIN/i.test(s.text));
      const liveAt = platformSql.findIndex((s) =>
        /SET status='LIVE'/.test(s.text),
      );
      const commitAt = platformSql.findIndex((s) => /^\s*COMMIT/i.test(s.text));
      expect(beginAt).toBeLessThan(liveAt);
      expect(liveAt).toBeLessThan(commitAt);
    });

    it("rolls the platform writes back when the plan is unknown", async () => {
      // The failure happens AFTER BEGIN, so the rollback is what stops a
      // half-written tenant. Asserted through the one failure mode that is
      // reachable without a real database.
      mockDb[config.DB_NAME] = platformDb({ plan: false });
      await rejection(
        svc.provisionTenant({ slug: "acme", name: "Acme", plan: "nope" }),
      );
      const platformSql = mockAllSql.filter(
        (s) => s.database === config.DB_NAME,
      );
      expect(
        platformSql.filter((s) => /^\s*ROLLBACK/i.test(s.text)),
      ).toHaveLength(1);
      expect(
        platformSql.filter((s) => /^\s*COMMIT/i.test(s.text)),
      ).toHaveLength(0);
    });

    it("leaves the tenant DATABASE outside the transaction, deliberately", async () => {
      // CREATE DATABASE cannot participate in a transaction on another
      // connection. The asymmetry is the right way round: an orphaned database
      // with no platform row is inert and re-provisioning is idempotent,
      // whereas a platform row pointing at a database that does not exist
      // routes live traffic into a 500.
      await svc.provisionTenant({ slug: "acme", name: "Acme Ltd" });
      const platformSql = mockAllSql.filter(
        (s) => s.database === config.DB_NAME,
      );
      const beginAt = platformSql.findIndex((s) => /^\s*BEGIN/i.test(s.text));
      // ensureDatabase ran before any platform transaction was opened.
      expect(mockEnsured).toEqual(["praxis_acme"]);
      expect(beginAt).toBeGreaterThanOrEqual(0);
      expect(mockApplied.some((a) => a.database === "praxis_acme")).toBe(true);
    });
  });

  describe("migrateAllTenants — DATA 3.2 containment", () => {
    it("migrates the whole fleet when nothing fails", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b", "c"] });
      const out = await svc.migrateAllTenants();
      expect(out.map((r) => r.slug)).toEqual(["a", "b", "c"]);
      expect(out.every((r) => r.error === undefined)).toBe(true);
    });

    it("CONTINUES past a failing tenant instead of splitting the fleet", async () => {
      // The finding, precisely: the first failure used to abort the loop, so
      // tenants after it were never touched and nothing recorded where the line
      // fell — during a deploy, while the new image rolled out to all of them.
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b", "c"] });
      mockFailMigrationFor = new Set(["praxis_b"]);

      const err = await rejection(svc.migrateAllTenants());
      expect(err.code).toBe("FLEET_MIGRATION_PARTIAL");

      // c was reached. That is the entire point.
      expect(err.results.map((r) => r.slug)).toEqual(["a", "b", "c"]);
      expect(err.results.find((r) => r.slug === "c").applied).toBeGreaterThan(
        0,
      );
    });

    it("enumerates which side of the line each tenant fell on", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b", "c"] });
      mockFailMigrationFor = new Set(["praxis_b"]);
      const err = await rejection(svc.migrateAllTenants());

      const b = err.results.find((r) => r.slug === "b");
      expect(b.applied).toBeNull();
      expect(b.error).toMatch(/does not exist/);
      expect(err.message).toMatch(/1 of 3 tenant\(s\) failed/);
      expect(err.message).toContain("b (");
      expect(err.message).toMatch(/fleet-status/); // says how to find out more
    });

    it("still fails the deploy — containment is not swallowing", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a"] });
      mockFailMigrationFor = new Set(["praxis_a"]);
      const err = await rejection(svc.migrateAllTenants());
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("FLEET_MIGRATION_PARTIAL");
    });

    it("reports every tenant when the cause is systematic", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b", "c"] });
      mockFailMigrationFor = new Set(["praxis_a", "praxis_b", "praxis_c"]);
      const err = await rejection(svc.migrateAllTenants());
      expect(err.message).toMatch(/3 of 3 tenant\(s\) failed/);
    });

    it("does not migrate an ARCHIVED tenant", async () => {
      // listTenantSlugs filters to LIVE/PROVISIONING. Migrating a decommissioned
      // tenant's database would resurrect it into the fleet report.
      await svc.listTenantSlugs();
      const read = sqlMatching(/SELECT slug FROM platform\.tenant/)[0];
      expect(read.text).toMatch(/status IN \('LIVE','PROVISIONING'\)/);
    });

    it("does not let a sandbox mirror failure fail a tenant's migration", async () => {
      // Best-effort by design: a deploy must not fail over sandbox convenience
      // data. Asserted because "best-effort" is exactly the kind of claim that
      // rots into a thrown error nobody notices until a deploy.
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a"] });
      mockMirrorFails = true;
      const out = await svc.migrateAllTenants();
      expect(out[0].error).toBeUndefined();
    });
  });

  describe("fleetSchemaStatus", () => {
    function statusDb(rowsBySlug) {
      for (const [slug, rows] of Object.entries(rowsBySlug)) {
        mockDb[`praxis_${slug}`] = (sql) =>
          /FROM public\.schema_migration/.test(sql) ? rows : [];
      }
    }

    it("reports a fleet that is level as undrifted", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b"] });
      statusDb({
        a: [{ scope: "live", applied: 3, latest: "s3.sql" }],
        b: [{ scope: "live", applied: 3, latest: "s3.sql" }],
      });
      const out = await svc.fleetSchemaStatus();
      expect(out.expected).toBe(3);
      expect(out.drifted).toBe(false);
      expect(out.behind).toEqual([]);
    });

    it("names the tenants that are behind", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b"] });
      statusDb({
        a: [{ scope: "live", applied: 3, latest: "s3.sql" }],
        b: [{ scope: "live", applied: 1, latest: "s1.sql" }],
      });
      const out = await svc.fleetSchemaStatus();
      expect(out.drifted).toBe(true);
      expect(out.behind).toEqual(["b"]);
      expect(out.tenants.find((t) => t.slug === "b").behind).toBe(2);
    });

    it("reports an unreachable tenant rather than failing the whole report", async () => {
      // "Which tenants can I not even reach" is exactly what you want during an
      // incident, and a throw here would take the answer with it.
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a", "b"] });
      statusDb({ a: [{ scope: "live", applied: 3, latest: "s3.sql" }] });
      mockUnreachable = new Set(["praxis_b"]);

      const out = await svc.fleetSchemaStatus();
      expect(out.unreachable).toEqual(["b"]);
      expect(out.drifted).toBe(true);
      expect(out.tenants.find((t) => t.slug === "a").applied).toBe(3);
    });

    it("reads the migration ledger rather than trusting a version column", async () => {
      mockDb[config.DB_NAME] = platformDb({ slugs: ["a"] });
      statusDb({ a: [{ scope: "live", applied: 3, latest: "s3.sql" }] });
      await svc.fleetSchemaStatus();
      expect(sqlMatching(/FROM public\.schema_migration/)).toHaveLength(1);
    });
  });

  describe("wipeSandbox", () => {
    it("rebuilds only the sandbox schema and leaves live untouched", async () => {
      await svc.wipeSandbox({ slug: "acme" });
      expect(sqlMatching(/DROP SCHEMA IF EXISTS sandbox CASCADE/)).toHaveLength(
        1,
      );
      expect(
        sqlMatching(/DROP SCHEMA/).every((s) => /sandbox/.test(s.text)),
      ).toBe(true);
      expect(sqlMatching(/DROP SCHEMA IF EXISTS live/)).toHaveLength(0);
    });

    it("clears only the sandbox scopes from the migration ledger", async () => {
      // Deleting the live scopes here would make the next migrate pass re-apply
      // the entire live history over a populated production schema.
      await svc.wipeSandbox({ slug: "acme" });
      const del = sqlMatching(/DELETE FROM public\.schema_migration/)[0];
      expect(del.text).toMatch(/scope IN \('sandbox','sandbox-seed'\)/);
      expect(del.text).not.toMatch(/'live'/);
    });

    it("re-mirrors users, because 60+ columns reference app_user", async () => {
      // The rebuilt schema has no users and the FKs are NOT NULL-guarded; without
      // this the tenant's first TEST-mode write fails with 23503.
      await svc.wipeSandbox({ slug: "acme" });
      expect(mockMirrored).toHaveLength(1);
      expect(mockMirrored[0].database).toBe("praxis_acme");
    });

    it("re-projects features so TEST mode does not diverge from LIVE", async () => {
      await svc.wipeSandbox({ slug: "acme" });
      expect(
        sqlMatching(/FROM platform\.tenant t JOIN platform\.feature_catalogue/),
      ).toHaveLength(1);
    });

    it("wraps the whole rebuild in ONE transaction (DI-5.6)", async () => {
      // This test previously asserted the OPPOSITE — that no BEGIN was issued —
      // as honest coverage of DI-5.6 while it was still open, specifically so
      // that fixing it would fail here and force a deliberate update. It did.
      //
      // The window it closes: between DROP SCHEMA and a successful rebuild the
      // tenant had NO sandbox schema, and the ledger DELETE had already run, so
      // a crash in that window left TEST mode broken with a ledger that claimed
      // the sandbox scopes were applied — self-healing was impossible.
      await svc.wipeSandbox({ slug: "acme" });
      const tenantSql = mockAllSql.filter((s) => s.database === "praxis_acme");
      expect(tenantSql.filter((s) => /^\s*BEGIN/i.test(s.text))).toHaveLength(
        1,
      );
      expect(tenantSql.filter((s) => /^\s*COMMIT/i.test(s.text))).toHaveLength(
        1,
      );

      // Ordering: the BEGIN must precede the DROP, or it protects nothing.
      const beginAt = tenantSql.findIndex((s) => /^\s*BEGIN/i.test(s.text));
      const dropAt = tenantSql.findIndex((s) => /DROP SCHEMA/i.test(s.text));
      const commitAt = tenantSql.findIndex((s) => /^\s*COMMIT/i.test(s.text));
      expect(beginAt).toBeLessThan(dropAt);
      expect(dropAt).toBeLessThan(commitAt);
    });

    it("rolls back and keeps the old sandbox when the rebuild fails", async () => {
      // The whole point of the transaction: a failure must not leave the tenant
      // schema-less. Postgres CAN roll back DROP/CREATE SCHEMA, unlike the
      // CREATE DATABASE in provisionTenant.
      mockFailMigrationFor = new Set(["praxis_acme"]);
      const err = await rejection(svc.wipeSandbox({ slug: "acme" }));
      expect(err.message).toMatch(/does not exist/);

      const tenantSql = mockAllSql.filter((s) => s.database === "praxis_acme");
      expect(
        tenantSql.filter((s) => /^\s*ROLLBACK/i.test(s.text)),
      ).toHaveLength(1);
      expect(tenantSql.filter((s) => /^\s*COMMIT/i.test(s.text))).toHaveLength(
        0,
      );
    });

    it("does not re-project features when the rebuild was rolled back", async () => {
      // Projecting onto a sandbox that was never rebuilt would write feature
      // rows into the OLD schema and report success.
      mockFailMigrationFor = new Set(["praxis_acme"]);
      await rejection(svc.wipeSandbox({ slug: "acme" }));
      expect(
        sqlMatching(/FROM platform\.tenant t JOIN platform\.feature_catalogue/),
      ).toHaveLength(0);
    });
  });

  describe("createAdmin — the account that bypasses RBAC (SEC H6)", () => {
    beforeEach(() => {
      mockDb.praxis_acme = (sql) => {
        if (/INSERT INTO app_user/.test(sql)) return [{ user_id: "u-1" }];
        if (/SELECT role_id FROM role/.test(sql)) return [{ role_id: "r-ceo" }];
        return [];
      };
    });

    it("rejects the passwords zod's min(8) used to wave through", async () => {
      for (const weak of ["password", "12345678", "Passw0rd"]) {
        const err = await rejection(
          svc.createAdmin({
            slug: "acme",
            email: "ceo@acme.example",
            password: weak,
          }),
        );
        expect(err.code).toBe("WEAK_PASSWORD");
      }
      expect(sqlMatching(/INSERT INTO app_user/)).toHaveLength(0);
    });

    it("requires a slug, an email and a password", async () => {
      expect(
        (
          await rejection(
            svc.createAdmin({ email: "a@b.example", password: "x" }),
          )
        ).message,
      ).toMatch(/slug is required/);
      const e = await rejection(
        svc.createAdmin({ slug: "acme", email: "a@b.example" }),
      );
      expect(e.message).toMatch(/email and password are required/);
      expect(e.status).toBe(400);
    });

    it("stores an argon2id hash and normalises the email", async () => {
      await svc.createAdmin({
        slug: "acme",
        email: "  CEO@Acme.Example ",
        password: "Tr0ubador!Quay7",
      });
      const insert = sqlMatching(/INSERT INTO app_user/)[0];
      expect(insert.params[0]).toBe("ceo@acme.example");
      expect(insert.params[2]).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(insert.params[2], "Tr0ubador!Quay7")).toBe(
        true,
      );
    });

    it("binds search_path to live before touching app_user", async () => {
      // Without this the admin could be created in whatever schema the
      // connection defaulted to — i.e. possibly sandbox, i.e. nobody can log in.
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
      });
      const tenantSql = mockAllSql.filter((s) => s.database === "praxis_acme");
      expect(tenantSql[0].text).toMatch(/SET search_path = live, public/);
    });

    it("refuses a role that is not seeded in the tenant", async () => {
      mockDb.praxis_acme = (sql) =>
        /INSERT INTO app_user/.test(sql) ? [{ user_id: "u-1" }] : [];
      const err = await rejection(
        svc.createAdmin({
          slug: "acme",
          email: "ceo@acme.example",
          password: "Tr0ubador!Quay7",
          role: "GHOST",
        }),
      );
      expect(err.message).toMatch(/role 'GHOST' is not seeded/);
      expect(err.status).toBe(400);
    });

    it("defaults to CEO and assigns the role", async () => {
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
      });
      expect(sqlMatching(/SELECT role_id FROM role/)[0].params[0]).toBe("CEO");
      expect(sqlMatching(/INSERT INTO user_role/)).toHaveLength(1);
    });

    it("is idempotent on email — a re-run resets the password and reactivates", async () => {
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
      });
      const insert = sqlMatching(/INSERT INTO app_user/)[0];
      expect(insert.text).toMatch(
        /ON CONFLICT \(email\) DO UPDATE SET password_hash = EXCLUDED\.password_hash, status = 'ACTIVE'/,
      );
    });

    it("mirrors the new admin into sandbox — the fresh-tenant hole", async () => {
      // Provisioning cannot mirror; it runs before any user exists. This is the
      // moment that closes it, and without it the tenant's very first TEST-mode
      // write fails its actor FK with 23503.
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
      });
      expect(mockMirrored).toHaveLength(1);
      expect(mockMirrored[0].userId).toBe("u-1");
    });

    it("audits the bootstrap into the platform trail", async () => {
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
        actorId: "op-1",
      });
      const audit = sqlMatching(/INSERT INTO platform\.platform_audit/)[0];
      expect(audit.params[2]).toBe("tenant.admin_created");
      expect(audit.params[4]).toMatchObject({
        email: "ceo@acme.example",
        role: "CEO",
      });
    });

    it("consults the breach corpus and fails open when it is unreachable", async () => {
      // Measured ACROSS the call, not read after a beforeEach reset — an
      // assertion on a counter nobody incremented is not an assertion.
      const before = fetchCalls;
      await svc.createAdmin({
        slug: "acme",
        email: "ceo@acme.example",
        password: "Tr0ubador!Quay7",
      });
      expect(fetchCalls).toBeGreaterThan(before);
      // Fail-open: HIBP being down must not block a tenant bootstrap.
      expect(sqlMatching(/INSERT INTO app_user/)).toHaveLength(1);
    });
  });
});
