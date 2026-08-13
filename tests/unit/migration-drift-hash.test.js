"use strict";

/**
 * WS-S4 — content-drift hashing in the migration ledger.
 *
 * The ledger keys on FILENAME. A migration edited after a tenant has run it
 * never re-applies, and `fleetSchemaStatus()` compares file COUNTS — which is
 * blind to that by construction, because the count is identical before and
 * after the edit. Two tenants end up with the same migration list and different
 * schemas, and nothing anywhere says so.
 *
 * Recording the file's hash at apply time is what makes it detectable. These
 * tests pin the three things that decide whether the check is trustworthy:
 * it catches a real edit, it does NOT cry wolf on line endings, and it reports
 * "cannot tell" separately from "changed".
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const m = require("../../src/services/platform/migrator");

describe("hashFile", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-hash-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  };

  test("the same content hashes the same", () => {
    const a = write("a.sql", "CREATE TABLE x (id int);\n");
    const b = write("b.sql", "CREATE TABLE x (id int);\n");
    expect(m.hashFile(a)).toBe(m.hashFile(b));
  });

  test("changed content hashes differently — the whole point", () => {
    const a = write("a.sql", "CREATE TABLE x (id int);\n");
    const b = write("b.sql", "CREATE TABLE x (id bigint);\n");
    expect(m.hashFile(a)).not.toBe(m.hashFile(b));
  });

  test("CRLF and LF hash identically", () => {
    // Without normalising, the same file checked out on Windows and on Linux
    // hashes differently and EVERY tenant looks drifted. A check that cries
    // wolf on a clean repository gets switched off, which is worse than not
    // having one.
    const unix = write("unix.sql", "CREATE TABLE x (\n  id int\n);\n");
    const win = write("win.sql", "CREATE TABLE x (\r\n  id int\r\n);\r\n");
    expect(m.hashFile(unix)).toBe(m.hashFile(win));
  });

  test("whitespace inside a line is NOT normalised away", () => {
    // Only line endings are normalised. `id int` and `id  int` are different
    // text, and a hash that ignored that would be quietly permissive about
    // edits it should catch.
    const a = write("a.sql", "CREATE TABLE x (id int);\n");
    const b = write("b.sql", "CREATE TABLE x (id  int);\n");
    expect(m.hashFile(a)).not.toBe(m.hashFile(b));
  });
});

describe("contentDrift", () => {
  // A fake client returning whatever ledger rows the test supplies.
  const cliWith = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

  // Real files from the repo, so the hashes are genuine rather than staged.
  const REAL = "platform/0094_backup_registry.sql";
  const REAL2 = "platform/0095_kaizen_ops.sql";
  const realHash = (rel) => m.hashFile(path.join(m.MIGRATIONS, rel));

  test("matching hashes report no drift", async () => {
    const cli = cliWith([
      { filename: REAL, sha256: realHash(REAL) },
      { filename: REAL2, sha256: realHash(REAL2) },
    ]);
    const r = await m.contentDrift(cli, "live");
    expect(r.drifted).toEqual([]);
    expect(r.checked).toBe(2);
  });

  test("a stale hash is reported as drift, with both hashes for the diff", async () => {
    const cli = cliWith([{ filename: REAL, sha256: "0".repeat(64) }]);
    const r = await m.contentDrift(cli, "live");
    expect(r.drifted).toHaveLength(1);
    expect(r.drifted[0].filename).toBe(REAL);
    expect(r.drifted[0].applied_sha256).toBe("0".repeat(64));
    expect(r.drifted[0].current_sha256).toBe(realHash(REAL));
  });

  test("rows with no hash are 'unhashed', NOT drift", async () => {
    // Everything applied before this column existed has a null hash. Counting
    // those as drift would flag every pre-existing tenant on the day it ships,
    // which is exactly how a new check gets ignored. "Cannot tell" is not
    // "changed".
    const cli = cliWith([
      { filename: REAL, sha256: null },
      { filename: REAL2, sha256: realHash(REAL2) },
    ]);
    const r = await m.contentDrift(cli, "live");
    expect(r.drifted).toEqual([]);
    expect(r.unhashed).toEqual([REAL]);
    expect(r.checked).toBe(1);
  });

  test("a ledger row whose file no longer exists is skipped, not crashed on", async () => {
    const cli = cliWith([
      { filename: "tenant/9999_deleted.sql", sha256: "abc" },
    ]);
    const r = await m.contentDrift(cli, "live");
    expect(r.drifted).toEqual([]);
    expect(r.checked).toBe(0);
  });

  test("it queries the ledger scoped, not the whole table", async () => {
    const cli = cliWith([]);
    await m.contentDrift(cli, "live");
    expect(cli.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE scope=$1"),
      ["live"],
    );
  });
});
