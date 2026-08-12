/**
 * Migration file applier — reusable core shared by the CLI scripts and the
 * platform API. Plain `pg` (no ORM); DDL runs as multi-statement simple queries.
 * Idempotent via a per-database ledger public.schema_migration(scope, filename),
 * so migrate/provision re-run safely and existing tenants can be upgraded.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const MIGRATIONS = path.resolve(__dirname, "../../../migrations");

const sorted = (dir, filter = () => true) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && filter(f))
    .sort()
    .map((f) => path.join(dir, f));

const files = {
  platform: () => sorted(path.join(MIGRATIONS, "platform")),
  tenantBootstrap: () => [path.join(MIGRATIONS, "tenant", "0001_extensions.sql")],
  tenantSchema: () =>
    sorted(path.join(MIGRATIONS, "tenant"), (f) => !f.startsWith("0001_")),
  tenantSeeds: () => sorted(path.join(MIGRATIONS, "seeds"), (f) => /^90/.test(f)),
  platformSeeds: () =>
    sorted(path.join(MIGRATIONS, "seeds"), (f) => /^91/.test(f)),
};

function client(database, opts = {}) {
  const superuser = opts.superuser === true;
  return new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database,
    user: superuser ? config.TENANT_DB_SUPERUSER : config.DB_USER,
    password: superuser
      ? config.TENANT_DB_SUPERUSER_PASSWORD
      : config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });
}

async function ensureDatabase(dbName) {
  const admin = client("postgres", { superuser: true });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [dbName],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      logger.info({ dbName }, "created database");
      return true;
    }
    return false;
  } finally {
    await admin.end();
  }
}

async function ensureLedger(cli) {
  await cli.query(
    "CREATE TABLE IF NOT EXISTS public.schema_migration (" +
      "scope text NOT NULL, filename text NOT NULL, " +
      "applied_at timestamptz NOT NULL DEFAULT now(), " +
      "PRIMARY KEY (scope, filename))",
  );
  // WS-S4 — content drift.
  //
  // The ledger keys on FILENAME, so a file edited after a tenant has already
  // run it never re-applies and nothing notices. `fleetSchemaStatus()` compares
  // file COUNTS, which is blind to it by construction: the count is identical
  // before and after the edit. That is the one drift class the existing check
  // cannot see, and it is the one that produces two tenants with the same
  // migration list and different schemas.
  //
  // Recording the hash at apply time makes it detectable — the applied hash and
  // the current file can simply be compared. Added here rather than in a
  // migration file because the ledger is created by this function, not by a
  // migration, and it must exist on every tenant DB including ones provisioned
  // before this change.
  await cli.query(
    "ALTER TABLE public.schema_migration ADD COLUMN IF NOT EXISTS sha256 text",
  );
}

/**
 * SHA-256 of a migration file's bytes.
 *
 * Line endings are normalised first. Without that, the same file checked out on
 * Windows and Linux hashes differently and every tenant looks drifted — a check
 * that cries wolf on a clean repository gets switched off, which is worse than
 * not having it.
 */
function hashFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

async function appliedSet(cli, scope) {
  const { rows } = await cli.query(
    "SELECT filename FROM public.schema_migration WHERE scope=$1",
    [scope],
  );
  return new Set(rows.map((r) => r.filename));
}

async function applyTracked(cli, fileList, opts) {
  const searchPath = opts.searchPath;
  const scope = opts.scope;
  await ensureLedger(cli);
  const done = await appliedSet(cli, scope);
  let applied = 0;
  for (const f of fileList) {
    const name = path.relative(MIGRATIONS, f);
    if (done.has(name)) continue;
    const sql = fs.readFileSync(f, "utf8");
    const prefixed = searchPath
      ? `SET search_path = ${searchPath};\n${sql}`
      : sql;
    // DATA 3.1: the DDL and the ledger row must commit together.
    //
    // These used to be two separate statements. A multi-statement simple query
    // is its own implicit transaction, so the FILE was atomic — but the INSERT
    // that records it was a second round-trip. Lose the connection, the pod, or
    // the deploy between the two and the schema change is applied while the
    // ledger says it is not. The next run re-applies it: fine for
    // `CREATE TABLE IF NOT EXISTS`, silently destructive for an `ALTER ... ADD
    // COLUMN` with a default backfill, an `UPDATE`, or a seed INSERT.
    //
    // One explicit transaction closes the window. Nothing is lost by wrapping:
    // the file was already running inside an implicit transaction block, so any
    // statement that cannot run in one (CREATE INDEX CONCURRENTLY, VACUUM,
    // CREATE DATABASE) could never have run here anyway — verified, none of the
    // 99 migration files in the repository uses one.
    //
    // The SET search_path is inside the transaction deliberately: it must not
    // leak to the next file, and ROLLBACK reverts it.
    try {
      await cli.query("BEGIN");
      try {
        await cli.query(prefixed);
        await cli.query(
          "INSERT INTO public.schema_migration(scope, filename, sha256) VALUES ($1,$2,$3)",
          [scope, name, hashFile(f)],
        );
        await cli.query("COMMIT");
      } catch (err) {
        // A failed ROLLBACK must never mask the error that caused it.
        try {
          await cli.query("ROLLBACK");
        } catch {
          /* connection already gone; the original error is the useful one */
        }
        throw err;
      }
      applied += 1;
      logger.debug({ file: name, scope }, "applied migration");
    } catch (err) {
      throw new Error(`Failed applying ${name} [${scope}]: ${err.message}`);
    }
  }
  return applied;
}

async function applyFiles(cli, fileList, opts = {}) {
  const searchPath = opts.searchPath;
  for (const f of fileList) {
    const sql = fs.readFileSync(f, "utf8");
    const prefixed = searchPath
      ? `SET search_path = ${searchPath};\n${sql}`
      : sql;
    await cli.query(prefixed);
  }
}

const slugOk = (s) =>
  typeof s === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(s);
const tenantDbName = (slug) => `tenant_${slug}`;

/**
 * WS-S4 — files whose CONTENT has changed since a database applied them.
 *
 * The ledger keys on filename, so an edited migration never re-applies and the
 * count-based drift check cannot see it: the count is identical before and
 * after the edit. Comparing the recorded hash against the file on disk is the
 * only way to catch it, and it is worth catching — it is precisely how two
 * tenants end up with the same migration list and different schemas.
 *
 * Rows recorded BEFORE this column existed have a null hash. Those are reported
 * separately as `unhashed` rather than as drift: "we cannot tell" is a
 * different claim from "this changed", and conflating them would flag every
 * pre-existing tenant as drifted on the day this ships, which is how a new
 * check gets ignored.
 */
async function contentDrift(cli, scope) {
  const { rows } = await cli.query(
    "SELECT filename, sha256 FROM public.schema_migration WHERE scope=$1",
    [scope],
  );

  const drifted = [];
  const unhashed = [];
  let checked = 0;

  for (const r of rows) {
    // Guard the filename before it reaches path.join. A row without a usable
    // one is not a drift finding, it is a row this check has nothing to say
    // about — and letting `path.join(dir, undefined)` throw would take the
    // WHOLE fleet status down with it, reporting every tenant as unreachable
    // over a secondary check. That is the "cries wolf" failure that gets a
    // check switched off, and it would block a deploy on a healthy fleet.
    if (!r.filename || typeof r.filename !== "string") continue;

    const abs = path.join(MIGRATIONS, r.filename);
    if (!fs.existsSync(abs)) continue; // a file deleted from the repo is a different problem
    if (!r.sha256) {
      unhashed.push(r.filename);
      continue;
    }
    checked += 1;
    const current = hashFile(abs);
    if (current !== r.sha256) {
      drifted.push({ filename: r.filename, applied_sha256: r.sha256, current_sha256: current });
    }
  }

  return { checked, drifted, unhashed };
}

module.exports = {
  files,
  client,
  ensureDatabase,
  ensureLedger,
  appliedSet,
  applyTracked,
  applyFiles,
  hashFile,
  contentDrift,
  slugOk,
  tenantDbName,
  MIGRATIONS,
};
