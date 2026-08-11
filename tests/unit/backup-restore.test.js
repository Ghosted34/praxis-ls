"use strict";

/**
 * WS-B1 / WS-B3 — backup and restore rehearsal.
 *
 * §3.2's finding is that backups were "neither scheduled centrally nor ever
 * rehearsed today, which means it is not yet a backup." These tests assert the
 * properties that make the difference between a backup and a file:
 *
 *   - a dump that FAILS PART-WAY must never be recorded as OK. This is the
 *     single most dangerous outcome in the whole subsystem: a truncated dump
 *     looks like a backup, reports like a backup, and fails only on the day it
 *     is needed. It gets the most coverage below.
 *   - a tenant that has NEVER been backed up must show up as such, not be
 *     silently absent from the report.
 *   - one tenant's failure must not stop the fleet.
 *   - retention must not delete a dump that is still inside its window, and
 *     weekly retention must be a superset of daily.
 *   - a drill must refuse to restore over anything that is not a scratch
 *     database unless explicitly told otherwise.
 *
 * Postgres, child processes and object storage are all mocked; the subject here
 * is the orchestration logic, not pg_dump.
 */

const { Readable } = require("stream");

jest.mock("../../src/services/platform/db", () => ({ query: jest.fn(), close: jest.fn() }));
jest.mock("../../src/services/platform/backup-storage.service", () => ({
  putStream: jest.fn(),
  openStream: jest.fn(),
  pruneRetention: jest.fn(),
  list: jest.fn(),
  remove: jest.fn(),
  driver: "local",
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(),
  closeAll: jest.fn(),
}));
jest.mock("../../src/services/tenant/db-credential.service", () => ({
  resolveCredential: jest.fn(async () => ({ user: "praxis_acme", password: "pw", source: "vault" })),
}));
jest.mock("child_process", () => ({ spawn: jest.fn() }));

const platformDb = require("../../src/services/platform/db");
const store = require("../../src/services/platform/backup-storage.service");
const { spawn } = require("child_process");
const backup = require("../../src/services/platform/backup.service");
const restore = require("../../src/services/platform/restore.service");

const meta = (slug = "acme") => ({
  slug,
  tenant_id: `tid-${slug}`,
  db_name: `tenant_${slug}`,
  db_host: "db.internal",
  db_port: 5432,
  live_schema: "live",
});

/** A fake pg_dump: emits some bytes, then exits with `code`. */
function fakePgDump({ code = 0, stderr = "" } = {}) {
  const stdout = Readable.from([Buffer.from("PGDMP-fake-bytes")]);
  const handlers = {};
  const child = {
    stdout,
    stderr: { on: (e, fn) => { if (e === "data" && stderr) fn(Buffer.from(stderr)); } },
    on: (event, fn) => {
      handlers[event] = fn;
      if (event === "close") setImmediate(() => fn(code));
      return child;
    },
  };
  return child;
}

beforeEach(() => {
  jest.clearAllMocks();
  // startRun returns an id; every other query is a no-op update.
  platformDb.query.mockResolvedValue({ rows: [{ backup_run_id: "run-1" }] });
  store.putStream.mockResolvedValue({
    key: "pg/acme/x.dump",
    location: "local:pg/acme/x.dump",
    bytes: 16,
    checksum: "abc123",
  });
});

describe("backupTenant", () => {
  test("records OK with bytes, location and checksum on success", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 0 }));
    const r = await backup.backupTenant(meta());

    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(16);
    expect(r.checksum).toBe("abc123");

    const update = platformDb.query.mock.calls.find(([sql]) => sql.includes("UPDATE platform.backup_run"));
    expect(update[1][1]).toBe("OK");
  });

  /**
   * The important one. pg_dump can write bytes and THEN fail — a disk filling
   * up mid-dump, the source database dying half way. The upload completes
   * happily, so a naive implementation marks the run OK and stores a truncated
   * dump that nobody discovers until a restore is attempted.
   */
  test("does NOT record OK when pg_dump exits non-zero after writing bytes", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 1, stderr: "server closed the connection unexpectedly" }));
    const r = await backup.backupTenant(meta());

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pg_dump exited 1/);

    const update = platformDb.query.mock.calls.find(([sql]) => sql.includes("UPDATE platform.backup_run"));
    expect(update[1][1]).toBe("FAILED");
  });

  test("opens the run row as FAILED so a crash mid-dump still leaves a trace", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 0 }));
    await backup.backupTenant(meta());
    const insert = platformDb.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO platform.backup_run"));
    expect(insert[0]).toMatch(/'FAILED'/);
  });

  test("records a storage failure as FAILED rather than throwing", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 0 }));
    store.putStream.mockRejectedValue(new Error("bucket unreachable"));
    const r = await backup.backupTenant(meta());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bucket unreachable/);
  });

  test("passes the password by environment, never in argv", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 0 }));
    await backup.backupTenant(meta());
    const [, args, opts] = spawn.mock.calls[0];
    expect(args.join(" ")).not.toMatch(/pw/);
    expect(opts.env.PGPASSWORD).toBe("pw");
  });

  test("dumps against the tenant's real host, not the transaction pooler", async () => {
    spawn.mockReturnValue(fakePgDump({ code: 0 }));
    await backup.backupTenant(meta());
    const [, args] = spawn.mock.calls[0];
    expect(args).toContain("--host=db.internal");
    expect(args).toContain("--format=custom");
  });
});

describe("backupFleet", () => {
  test("continues past a failing tenant and reports which failed", async () => {
    spawn
      .mockReturnValueOnce(fakePgDump({ code: 0 }))
      .mockReturnValueOnce(fakePgDump({ code: 1, stderr: "boom" }))
      .mockReturnValueOnce(fakePgDump({ code: 0 }));

    // preflight off: it is exercised on its own below, and leaving it on here
    // would consume the first mocked spawn for a `--version` call.
    const r = await backup.backupFleet({
      tenants: [meta("a"), meta("b"), meta("c")],
      preflight: false,
    });

    expect(r.total).toBe(3);
    expect(r.ok).toBe(2);
    expect(r.failed_slugs).toEqual(["b"]);
  });

  /**
   * A version-skewed or absent client fails identically for every tenant. Fifty
   * identical FAILED rows say "the fleet is broken" when the true answer is
   * "one package is wrong" — so the check happens once, up front, and the run
   * stops rather than manufacturing noise.
   */
  test("aborts the whole run when the client tooling is unusable", async () => {
    spawn.mockImplementation(() => {
      const child = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, fn) => {
          if (event === "error") {
            const err = new Error("spawn pg_dump ENOENT");
            err.code = "ENOENT";
            setImmediate(() => fn(err));
          }
          return child;
        },
      };
      return child;
    });

    const r = await backup.backupFleet({ tenants: [meta("a"), meta("b")] });
    expect(r.total).toBe(0);
    expect(r.preflight_error).toMatch(/pg_dump not found/);
    expect(r.results).toEqual([]);
  });
});

describe("preflight", () => {
  /** A fake binary that answers `--version` with whatever string is given. */
  const versionSaying = (text) => () => {
    const child = {
      stdout: { on: (e, fn) => e === "data" && fn(Buffer.from(text)) },
      stderr: { on: () => {} },
      on: (event, fn) => {
        if (event === "close") setImmediate(() => fn(0));
        return child;
      },
    };
    return child;
  };

  /** pg_dump refuses to dump a server newer than itself. That is no backup at all. */
  test("rejects a client older than the server", async () => {
    spawn
      .mockImplementationOnce(versionSaying("pg_dump (PostgreSQL) 15.6"))
      .mockImplementationOnce(versionSaying("pg_restore (PostgreSQL) 15.6"));
    platformDb.query.mockResolvedValue({ rows: [{ server_version: "16.2" }] });

    const p = await backup.preflight();
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/OLDER than the server/);
    expect(p.error).toMatch(/postgresql16-client/);
  });

  /** A NEWER client against an older server is explicitly supported. */
  test("accepts a client newer than the server", async () => {
    spawn
      .mockImplementationOnce(versionSaying("pg_dump (PostgreSQL) 17.4"))
      .mockImplementationOnce(versionSaying("pg_restore (PostgreSQL) 17.4"));
    platformDb.query.mockResolvedValue({ rows: [{ server_version: "16.2" }] });

    const p = await backup.preflight();
    expect(p.ok).toBe(true);
    expect(p.error).toBeNull();
  });

  /**
   * The regression test for a configuration slip that cost hours.
   *
   * PG_RESTORE_BIN pointing at pg_dump does not error in any obvious way:
   * `pg_dump --dbname=<scratch>` dumps the empty scratch database to a
   * discarded stdout and exits 0. The drill sees a fast, silent, successful
   * process and an empty database, and concludes the BACKUP is corrupt. The
   * identity check turns that into one line.
   */
  test("rejects a binary that is not the tool it is configured as", async () => {
    spawn
      .mockImplementationOnce(versionSaying("pg_dump (PostgreSQL) 18.1"))
      .mockImplementationOnce(versionSaying("pg_dump (PostgreSQL) 18.1")); // PG_RESTORE_BIN → pg_dump
    platformDb.query.mockResolvedValue({ rows: [{ server_version: "18.1" }] });

    const p = await backup.preflight();
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/is not pg_restore/);
    expect(p.error).toMatch(/PG_RESTORE_BIN/);
  });

  test("reports a missing binary by name", async () => {
    spawn.mockImplementation(() => {
      const child = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, fn) => {
          if (event === "error") {
            const err = new Error("spawn ENOENT");
            err.code = "ENOENT";
            setImmediate(() => fn(err));
          }
          return child;
        },
      };
      return child;
    });

    const p = await backup.preflight();
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/pg_dump not found/);
  });
});

describe("backupStatus", () => {
  test("flags a tenant that has never been backed up rather than omitting it", async () => {
    platformDb.query.mockResolvedValue({
      rows: [
        { slug: "fresh", last_ok_at: new Date(), last_ok_bytes: 10 },
        { slug: "never", last_ok_at: null, last_ok_bytes: null },
      ],
    });
    const s = await backup.backupStatus();
    const never = s.tenants.find((t) => t.slug === "never");
    expect(never.never_backed_up).toBe(true);
    expect(never.stale).toBe(true);
    expect(s.never_count).toBe(1);
  });

  test("marks a backup older than the RPO plus grace as stale", async () => {
    const old = new Date(Date.now() - 40 * 3600 * 1000);
    platformDb.query.mockResolvedValue({ rows: [{ slug: "old", last_ok_at: old, last_ok_bytes: 1 }] });
    const s = await backup.backupStatus({ rpoHours: 24, graceHours: 6 });
    expect(s.tenants[0].stale).toBe(true);
  });

  test("a backup inside the RPO is not stale", async () => {
    platformDb.query.mockResolvedValue({
      rows: [{ slug: "ok", last_ok_at: new Date(Date.now() - 3600 * 1000), last_ok_bytes: 1 }],
    });
    const s = await backup.backupStatus();
    expect(s.tenants[0].stale).toBe(false);
    expect(s.stale_count).toBe(0);
  });
});

describe("restore drill safety", () => {
  test("refuses a target that is not a scratch database", async () => {
    await expect(
      restore.restoreTenant({ slug: "acme", into: "tenant_acme", recordDrill: false }),
    ).rejects.toThrow(/not a drill database/);
  });

  test("allows a non-drill target only when explicitly recovering", async () => {
    // Fails later for want of a backup — the point is it got PAST the guard.
    platformDb.query.mockResolvedValue({ rows: [] });
    const r = await restore.restoreTenant({
      slug: "acme",
      into: "tenant_acme_recovered",
      allowNonDrillTarget: true,
      drop: false,
      recordDrill: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no successful PG_DUMP/);
  });

  test("reports failure — not a throw — when the tenant has no backup at all", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    const r = await restore.restoreTenant({ slug: "acme", recordDrill: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no successful PG_DUMP/);
    expect(r.rto_seconds).toBeGreaterThanOrEqual(0);
  });

  test("parses both driver location formats back to a storage key", () => {
    expect(restore.keyFromLocation("local:pg/acme/x.dump")).toBe("pg/acme/x.dump");
    expect(restore.keyFromLocation("s3://praxis-backups/pg/acme/x.dump")).toBe("pg/acme/x.dump");
  });
});

describe("retention", () => {
  // The real pruneRetention is under test here, so un-mock it for this block.
  const realStore = jest.requireActual("../../src/services/platform/backup-storage.service");
  const day = 86_400_000;

  /** Drive the real retention logic with injected list/remove — no bucket, no disk. */
  const prune = (objects, now) => {
    const remove = jest.fn().mockResolvedValue();
    return realStore
      .pruneRetention({ prefix: "pg/", now, list: async () => objects, remove })
      .then((r) => ({ ...r, remove }));
  };

  test("keeps everything inside the daily window", async () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const r = await prune(
      [
        { key: "pg/a/1.dump", modified: new Date(now - 5 * day) },
        { key: "pg/a/2.dump", modified: new Date(now - 29 * day) },
      ],
      now,
    );
    expect(r.removed).toEqual([]);
    expect(r.remove).not.toHaveBeenCalled();
  });

  /**
   * Weekly retention is a SUPERSET of daily, so a Sunday dump that has aged out
   * of the daily window must survive on the weekly rule. Getting the order of
   * these two tests wrong deletes the long-term copies and nobody notices until
   * they are asked for a dump from two months ago.
   */
  test("keeps an aged Sunday dump but drops an aged weekday one", async () => {
    const now = new Date("2026-08-10T00:00:00Z"); // a Monday
    const agedSunday = new Date("2026-06-07T00:00:00Z"); // Sunday, ~64 days old
    const agedTuesday = new Date("2026-06-09T00:00:00Z"); // Tuesday, ~62 days old
    expect(agedSunday.getUTCDay()).toBe(0);

    const r = await prune(
      [
        { key: "pg/a/sunday.dump", modified: agedSunday },
        { key: "pg/a/tuesday.dump", modified: agedTuesday },
      ],
      now,
    );
    expect(r.removed).toEqual(["pg/a/tuesday.dump"]);
  });

  test("drops a Sunday dump once it is past the weekly window too", async () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const ancientSunday = new Date("2026-01-04T00:00:00Z"); // Sunday, >12 weeks
    expect(ancientSunday.getUTCDay()).toBe(0);

    const r = await prune([{ key: "pg/a/ancient.dump", modified: ancientSunday }], now);
    expect(r.removed).toEqual(["pg/a/ancient.dump"]);
  });
});
