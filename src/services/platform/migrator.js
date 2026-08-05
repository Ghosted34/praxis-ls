/**
 * Migration file applier — reusable core shared by the CLI scripts and the
 * platform API. Plain `pg` (no ORM); DDL runs as multi-statement simple queries.
 * Idempotent via a per-database ledger public.schema_migration(scope, filename),
 * so migrate/provision re-run safely and existing tenants can be upgraded.
 */
"use strict";

const fs = require("fs");
const path = require("path");
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
          "INSERT INTO public.schema_migration(scope, filename) VALUES ($1,$2)",
          [scope, name],
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

module.exports = {
  files,
  client,
  ensureDatabase,
  ensureLedger,
  appliedSet,
  applyTracked,
  applyFiles,
  slugOk,
  tenantDbName,
  MIGRATIONS,
};
