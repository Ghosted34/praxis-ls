"use strict";

/**
 * A tenant that does not live on the default database server must be restored,
 * inspected and cleaned up ON ITS OWN SERVER.
 *
 * WHY THIS IS WORTH A TEST FILE OF ITS OWN
 *
 *   `spawnPgDump` has always read `db_host` per tenant; every connection on the
 *   restore side assumed `TENANT_DB_HOST_DEFAULT`. While the whole fleet sits
 *   on one server those are the same string, which is exactly what makes the
 *   bug invisible: nothing fails, no test goes red, and the fault appears the
 *   first time a tenant is moved — as a drill that builds its scratch copy on
 *   the wrong machine, compares it against a source it cannot reach, and
 *   reports the result as though it had proved something.
 *
 *   So the assertion is not "the code passes a host through". It is that every
 *   connection the restore opens, and the pg_restore invocation itself, points
 *   at the server the REGISTRY names for that tenant — and, in the second
 *   test, that a tenant on the default server is untouched by the change.
 *
 * Postgres, pg_restore, the object store and the migrator are all mocked: the
 * subject is where the connections are aimed, not what they do when they land.
 */

/**
 * `stream` is required at each use site rather than destructured up here: the
 * mock factories below are hoisted above every import, and the hoisting gate
 * (scripts/check-jest-mock-hoisting.js) reads a top-level `Readable` referenced
 * anywhere near them as a factory closing over an uninitialised variable.
 */

/** Every `new Client(...)` the service opens, in order. */
const mockClients = [];

jest.mock("pg", () => ({
  Client: jest.fn(function FakeClient(cfg) {
    const client = {
      config: cfg,
      connect: jest.fn(async () => {}),
      end: jest.fn(async () => {}),
      // Answers whatever the probes ask in a shape they can read. The counts
      // are deliberately identical on both sides so the drill's own verdict
      // does not distract from what is being asserted here.
      query: jest.fn(async (sql) => {
        if (/pg_namespace/.test(sql)) return { rows: [{ nspname: "live" }] };
        if (/information_schema\.tables/.test(sql)) return { rows: [{ n: 12 }] };
        if (/document_vault/.test(sql)) return { rows: [] };
        if (/sum\(/i.test(sql)) return { rows: [{ debits: "0", credits: "0" }] };
        return { rows: [{ n: 1 }] };
      }),
    };
    mockClients.push(client);
    return client;
  }),
}));

jest.mock("../../src/services/platform/db", () => ({
  query: jest.fn(async () => ({ rows: [] })),
  close: jest.fn(),
}));
// 16 bytes, matching the `bytes` on the backup_run row below: the drill checks
// the stored artefact against what the registry recorded and refuses to go on
// if they disagree, which is a different failure from the one under test here.
jest.mock("../../src/services/platform/backup-storage.service", () => ({
  stat: jest.fn(async () => ({ bytes: 16 })),
  openStream: jest.fn(async () =>
    require("stream").Readable.from([Buffer.from("PGDMP-fake-bytes")]),
  ),
  driver: "local",
}));
jest.mock("../../src/services/platform/runtime-config.service", () => ({
  opsTuning: jest.fn(async () => ({ restoreRtoTargetSeconds: 3600 })),
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(),
}));
jest.mock("../../src/services/platform/migrator", () => ({
  slugOk: () => true,
  ensureDatabase: jest.fn(async () => {}),
}));
jest.mock("../../src/services/platform/backup.service", () => ({
  preflight: jest.fn(async () => ({ ok: true, pg_restore: "16.2", server: "16.2" })),
}));
jest.mock("child_process", () => ({ spawn: jest.fn() }));

const { spawn } = require("child_process");
const platformDb = require("../../src/services/platform/db");
const registry = require("../../src/services/tenant/registry.service");
const migrator = require("../../src/services/platform/migrator");
const restore = require("../../src/services/platform/restore.service");

/** A fake pg_restore that reads its input and exits cleanly. */
function fakePgRestore() {
  const child = {
    stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
    stderr: { on: jest.fn() },
    on: (event, fn) => {
      if (event === "close") setImmediate(() => fn(0));
      return child;
    },
  };
  return child;
}

const tenantOn = (host, port) => ({
  slug: "acme",
  tenant_id: "tid-acme",
  db_name: "tenant_acme",
  db_host: host,
  db_port: port,
  live_schema: "live",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockClients.length = 0;

  // The dump the drill will "restore".
  platformDb.query.mockImplementation(async (sql) => {
    if (/FROM platform\.backup_run/.test(sql)) {
      return {
        rows: [
          {
            backup_run_id: "run-1",
            location: "local:pg/acme/latest.dump",
            started_at: new Date().toISOString(),
            bytes: 16,
          },
        ],
      };
    }
    return { rows: [] };
  });

  spawn.mockImplementation(() => fakePgRestore());
  const storeMock = require("../../src/services/platform/backup-storage.service");
  storeMock.openStream.mockImplementation(async () =>
    require("stream").Readable.from([Buffer.from("PGDMP-fake-bytes")]),
  );
});

describe("a tenant on a non-default database server", () => {
  test("is restored, read and cleaned up on ITS OWN server", async () => {
    registry.listActiveTenants.mockResolvedValue([tenantOn("db2.internal", 6432)]);

    await restore.restoreTenant({ slug: "acme", recordDrill: false });

    // 1. The scratch database is created on that server, not the default.
    expect(migrator.ensureDatabase).toHaveBeenCalledWith(
      expect.any(String),
      { host: "db2.internal", port: 6432 },
    );

    // 2. pg_restore is pointed at it.
    const args = spawn.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(["--host=db2.internal", "--port=6432"]));

    // 3. EVERY connection the drill opened — the live source it compares
    //    against, the restored copy it probes, and the admin connection that
    //    drops the copy — went to the same place. One stray default host here
    //    is a comparison against the wrong database that still reports "passed".
    expect(mockClients.length).toBeGreaterThan(0);
    for (const c of mockClients) {
      expect(c.config.host).toBe("db2.internal");
      expect(c.config.port).toBe(6432);
    }
  });

  test("a tenant on the default server is unaffected by the change", async () => {
    // The whole fleet is on one server today, so this is the path that actually
    // runs — the fix must be invisible to it.
    registry.listActiveTenants.mockResolvedValue([tenantOn("db.internal", 5432)]);

    await restore.restoreTenant({ slug: "acme", recordDrill: false });

    const args = spawn.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(["--host=db.internal", "--port=5432"]));
    for (const c of mockClients) expect(c.config.host).toBe("db.internal");
  });

  test("an unknown tenant falls back to the configured default rather than crashing", async () => {
    // A slug with no registry row cannot be routed anywhere in particular. The
    // drill must still report a result: throwing here would take the scheduled
    // sweep down and record nothing at all for the tenants after it.
    registry.listActiveTenants.mockResolvedValue([]);

    const r = await restore.restoreTenant({ slug: "acme", recordDrill: false });
    expect(r).toHaveProperty("ok");
    expect(migrator.ensureDatabase).toHaveBeenCalledWith(expect.any(String), {});
  });

  test("a registry that is down is a failed drill, not a thrown exception", async () => {
    registry.listActiveTenants.mockRejectedValue(new Error("registry unreachable"));

    const r = await restore.restoreTenant({ slug: "acme", recordDrill: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/registry unreachable/);
  });
});
