"use strict";

/**
 * The idempotency gate, tested against the SQL shapes it exists to catch.
 *
 * A guard script is the one kind of code where "it passed" proves nothing —
 * a checker that matches nothing reports every file clean and is counted as
 * working. `check-jest-mock-hoisting.js` says this about itself in its own
 * header, having shipped a version whose regex silently errored.
 *
 * So these feed it known-bad SQL and require it to complain, and known-good SQL
 * and require it not to. The negative cases matter more than the positive ones:
 * a false positive costs a rename, a false negative costs the outage the gate
 * was written for.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT = path.join(__dirname, "../../scripts/db/check-migration-idempotency.js");

/**
 * The rule engine is not exported (the script is a CLI that calls
 * `process.exit`), so it is loaded by reading the file and evaluating it with a
 * stubbed exit. Cheaper and far more legible than shelling out per case.
 */
function loadViolations() {
  const src = fs.readFileSync(SCRIPT, "utf8").replace(/process\.exit\(main\(\)\);?\s*$/, "module.exports = { violations };");
  const tmp = path.join(os.tmpdir(), `idem-${process.pid}.js`);
  fs.writeFileSync(tmp, src);

  const mod = require(tmp);
  fs.unlinkSync(tmp);
  return mod.violations;
}

const violations = loadViolations();
const ids = (sql) => violations(sql).map((v) => v.rule).sort();

describe("catches the statements that break a re-run", () => {
  it("flags an unguarded CREATE TABLE — the exact error from the incident", () => {
    expect(ids("CREATE TABLE platform.error_event (id uuid);")).toContain("create-table");
  });

  it("flags an unguarded index and a unique index", () => {
    expect(ids("CREATE INDEX ix_a ON t (c);")).toContain("create-index");
    expect(ids("CREATE UNIQUE INDEX ux_a ON t (c);")).toContain("create-index");
  });

  it("flags an unguarded trigger", () => {
    expect(ids("CREATE TRIGGER trg_x BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f();"))
      .toContain("create-trigger");
  });

  it("flags CREATE FUNCTION without OR REPLACE", () => {
    expect(ids("CREATE FUNCTION f() RETURNS int AS 'SELECT 1' LANGUAGE sql;")).toContain("create-function");
  });

  it("flags ADD COLUMN, DROP, CREATE SCHEMA and CREATE EXTENSION", () => {
    expect(ids("ALTER TABLE t ADD COLUMN c int;")).toContain("add-column");
    expect(ids("DROP TABLE t;")).toContain("drop-anything");
    expect(ids("CREATE SCHEMA live;")).toContain("create-schema");
    expect(ids("CREATE EXTENSION vector;")).toContain("create-extension");
  });

  it("flags the two shapes Postgres gives NO native guard for", () => {
    // There is no ADD CONSTRAINT IF NOT EXISTS and no CREATE TYPE IF NOT
    // EXISTS, in any version. These are the most common reason a migration
    // that "looks idempotent" is not.
    expect(ids("ALTER TABLE t ADD CONSTRAINT ck_x CHECK (n > 0);")).toContain("add-constraint");
    expect(ids("CREATE TYPE mood AS ENUM ('a','b');")).toContain("create-type");
  });

  it("flags a seed INSERT with no conflict target", () => {
    // The failure migrator.js names: re-running silently double-inserts.
    expect(ids("INSERT INTO plan (code) VALUES ('PRO');")).toContain("insert-without-conflict");
  });
});

describe("does NOT flag correct SQL", () => {
  it("accepts every native guard", () => {
    const sql = `
      CREATE SCHEMA IF NOT EXISTS live;
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS live.t (id uuid PRIMARY KEY);
      ALTER TABLE live.t ADD COLUMN IF NOT EXISTS c int;
      CREATE INDEX IF NOT EXISTS ix_t ON live.t (c);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_t ON live.t (c);
      CREATE OR REPLACE FUNCTION live.f() RETURNS int AS 'SELECT 1' LANGUAGE sql;
      CREATE OR REPLACE VIEW live.v AS SELECT 1;
      CREATE OR REPLACE TRIGGER trg BEFORE UPDATE ON live.t FOR EACH ROW EXECUTE FUNCTION live.f();
      DROP INDEX IF EXISTS live.ix_old;
      INSERT INTO live.t (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;
    `;
    expect(violations(sql)).toEqual([]);
  });

  it("treats a DO block as the guard it is", () => {
    // The only way to make ADD CONSTRAINT and CREATE TYPE rerunnable.
    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mood') THEN
          CREATE TYPE mood AS ENUM ('a','b');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_x') THEN
          ALTER TABLE t ADD CONSTRAINT ck_x CHECK (n > 0);
        END IF;
      END $$;
    `;
    expect(violations(sql)).toEqual([]);
  });

  it("ignores commented-out DOWN blocks", () => {
    // Every reversible migration in this repo ends with a commented DROP list.
    // Matching those would flag the files that did the RIGHT thing.
    const sql = `
      CREATE TABLE IF NOT EXISTS t (id uuid);
      -- DOWN
      -- DROP TABLE platform.t;
      -- DROP INDEX ix_t;
      /* CREATE TABLE ghost (id uuid); */
    `;
    expect(violations(sql)).toEqual([]);
  });

  it("judges ON CONFLICT per STATEMENT, not per file", () => {
    // A file-wide search would let an unguarded insert pass because some other
    // insert in the same file happened to be guarded.
    const sql = `
      INSERT INTO a (x) VALUES (1) ON CONFLICT DO NOTHING;
      INSERT INTO b (x) VALUES (2);
    `;
    expect(ids(sql)).toEqual(["insert-without-conflict"]);
  });

  it("does not confuse CREATE INDEX CONCURRENTLY with an unguarded index", () => {
    // It cannot run inside the migrator's transaction anyway; flagging it for
    // the wrong reason would send the author to the wrong fix.
    expect(ids("CREATE INDEX CONCURRENTLY ix ON t (c);")).not.toContain("create-index");
  });
});

describe("the baseline is real", () => {
  const baseline = require("../../scripts/db/migration-idempotency-baseline.json");

  it("froze every migration that existed when the gate landed", () => {
    // A baseline that quietly lost entries would silently start gating —
    // or worse, stop freezing — files nobody meant to touch.
    expect(Object.keys(baseline.files).length).toBeGreaterThan(100);
    expect(baseline.files["platform/0090_error_monitor.sql"]).toBeDefined();
  });

  it("passes its own gate as committed", () => {
    // The end-to-end assertion: run the real script over the real repo.
    //
    // Asserting on the EXIT CODE, not stdout: these check scripts report through
    // console.warn/error, which is stderr, so a stdout assertion passes on an
    // empty string and would go green if the script printed nothing at all.
    const r = spawnSync("node", [SCRIPT], { encoding: "utf8" });
    expect(`${r.stderr}${r.stdout}`).toMatch(/Migration idempotency OK/);
    expect(r.status).toBe(0);
  });

});

/**
 * End-to-end, against a THROWAWAY migrations tree.
 *
 * The script takes `PRAXIS_MIGRATIONS_DIR` / `PRAXIS_IDEMPOTENCY_BASELINE`
 * purely so this can exist. The first version of these tests wrote a bad
 * migration into the real `migrations/platform/` and deleted it in a `finally` —
 * which failed on a filesystem that refuses unlink, leaving the probe file
 * committed. A test that can damage the repo when it fails is not worth the
 * coverage; the seam is.
 */
describe("end-to-end, on a disposable tree", () => {
  let dir;
  let baselineFile;

  const run = () =>
    spawnSync("node", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PRAXIS_MIGRATIONS_DIR: dir, PRAXIS_IDEMPOTENCY_BASELINE: baselineFile },
    });

  const write = (rel, sql) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, sql);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-migrations-"));
    baselineFile = path.join(dir, "baseline.json");
    write("platform/0001_base.sql", "CREATE TABLE IF NOT EXISTS platform.a (id uuid);\n");
    expect(spawnSync("node", [SCRIPT, "--update-baseline"], {
      encoding: "utf8",
      env: { ...process.env, PRAXIS_MIGRATIONS_DIR: dir, PRAXIS_IDEMPOTENCY_BASELINE: baselineFile },
    }).status).toBe(0);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is clean immediately after baselining", () => {
    expect(run().status).toBe(0);
  });

  it("fails a NEW migration that is not idempotent", () => {
    write("platform/0002_new.sql", "CREATE TABLE platform.b (id uuid);\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not safe to run twice/);
    expect(r.stderr).toContain("create-table");
  });

  it("passes a NEW migration that is idempotent", () => {
    write(
      "platform/0002_new.sql",
      "CREATE TABLE IF NOT EXISTS platform.b (id uuid);\n"
        + "CREATE INDEX IF NOT EXISTS ix_b ON platform.b (id);\n",
    );
    expect(run().status).toBe(0);
  });

  it("fails loudly when a BASELINED migration is edited — the DATA 3.3 guard", () => {
    write("platform/0001_base.sql", "CREATE TABLE IF NOT EXISTS platform.a (id uuid, extra int);\n");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/EDITED/);
    expect(r.stderr).toContain("platform/0001_base.sql");
    // The message has to name the remedy, or the next person just re-baselines.
    expect(r.stderr).toMatch(/goes in a NEW migration/);
  });

  it("is content-based, not sticky — restoring the file clears the failure", () => {
    const original = fs.readFileSync(path.join(dir, "platform/0001_base.sql"), "utf8");
    write("platform/0001_base.sql", `${original}-- tampered\n`);
    expect(run().status).toBe(1);
    write("platform/0001_base.sql", original);
    expect(run().status).toBe(0);
  });

  it("a RENAME reads as both a deletion and a new file — the incident, mechanically", () => {
    // 0090_b → 0100_b is what started this. The gate cannot stop the rename, but
    // it makes it visible: the new name is ungrandfathered and must be idempotent
    // before it can land, and the operator is pointed at mark-migration-applied.
    const sql = fs.readFileSync(path.join(dir, "platform/0001_base.sql"), "utf8");
    fs.rmSync(path.join(dir, "platform/0001_base.sql"));
    write("platform/0002_base.sql", `${sql}CREATE TABLE platform.c (id uuid);\n`);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/mark-migration-applied/);
  });
});
