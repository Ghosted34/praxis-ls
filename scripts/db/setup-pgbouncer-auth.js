#!/usr/bin/env node
/**
 * WS-S1 — create the PgBouncer auth_query lookup role and function.
 *
 * PgBouncer in transaction mode fronts one database per tenant, and WS-S2 gives
 * each tenant its own Postgres role. A static `userlist.txt` would therefore
 * have to be regenerated and the pooler reloaded on every provision and every
 * credential rotation — and the failure mode of forgetting is a tenant that
 * cannot authenticate, which looks exactly like a database outage.
 *
 * `auth_query` removes that coupling: PgBouncer asks Postgres for the
 * credential at connect time, so provisioning and rotation need to know nothing
 * about the pooler.
 *
 * WHY A SECURITY DEFINER FUNCTION RATHER THAN QUERYING pg_shadow
 *
 *   The naive auth_query reads `pg_shadow` directly, which only a SUPERUSER may
 *   do — so the lookup role would have to be superuser, and PgBouncer would be
 *   holding superuser credentials to answer "what is the hash for this one
 *   username". That is an enormous grant for a trivial question, and it is a
 *   credential sitting in a config file.
 *
 *   Instead: a SECURITY DEFINER function owned by the superuser, EXECUTE granted
 *   only to the lookup role, which is itself an ordinary NOLOGIN-adjacent
 *   account with no rights to anything else. The lookup role can resolve a
 *   username and do nothing more.
 *
 *   The function is also STRICT and revoked from PUBLIC, so it cannot be used
 *   as a credential-dumping oracle by any other role that happens to connect.
 *
 * IDEMPOTENT. Safe to re-run — it is how you rotate the lookup password.
 *
 * USAGE
 *   node scripts/db/setup-pgbouncer-auth.js
 *   PGBOUNCER_AUTH_PASSWORD=... node scripts/db/setup-pgbouncer-auth.js
 *   node scripts/db/setup-pgbouncer-auth.js --check    # verify, change nothing
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { Client } = require("pg");
const { config } = require("../../src/config/env");

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");

// From the validated schema rather than raw process.env, so these are checked
// the same way every other setting is and `.env.example` can honestly document
// them as application config.
const AUTH_USER = config.PGBOUNCER_AUTH_USER || "pgbouncer";
const AUTH_PASSWORD = config.PGBOUNCER_AUTH_PASSWORD || "";

/** Identifiers are interpolated, so they are validated rather than trusted. */
function assertIdent(name, what) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(name)) {
    throw new Error(`${what} "${name}" is not a valid Postgres identifier`);
  }
  return name;
}

async function main() {
  assertIdent(AUTH_USER, "PGBOUNCER_AUTH_USER");

  if (!CHECK_ONLY && !AUTH_PASSWORD) {
    console.error("PGBOUNCER_AUTH_PASSWORD is not set.");
    console.error("It must match the value given to the pgbouncer container, or every");
    console.error("pooled connection fails auth in a way that resembles a DB outage.");
    process.exit(1);
  }

  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
  });

  await client.connect();

  try {
    const { rows: su } = await client.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    if (!su[0] || !su[0].rolsuper) {
      console.error(`Connected as "${config.DB_USER}", which is not a superuser.`);
      console.error("Creating a SECURITY DEFINER function over pg_shadow requires one.");
      process.exit(1);
    }

    if (CHECK_ONLY) {
      const { rows } = await client.query(
        `SELECT
           (SELECT count(*) FROM pg_roles WHERE rolname = $1)::int              AS role_exists,
           (SELECT count(*) FROM pg_namespace WHERE nspname = 'pgbouncer')::int AS schema_exists,
           (SELECT count(*) FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'pgbouncer' AND p.proname = 'get_auth')::int     AS fn_exists`,
        [AUTH_USER],
      );
      const r = rows[0];
      const ok = r.role_exists && r.schema_exists && r.fn_exists;
      console.warn(`role ${AUTH_USER}: ${r.role_exists ? "present" : "MISSING"}`);
      console.warn(`schema pgbouncer: ${r.schema_exists ? "present" : "MISSING"}`);
      console.warn(`function pgbouncer.get_auth: ${r.fn_exists ? "present" : "MISSING"}`);
      console.warn(ok ? "\nauth_query is set up." : "\nNOT set up — run without --check.");
      process.exit(ok ? 0 : 1);
    }

    // Role. CREATE then ALTER rather than DROP/CREATE: dropping a role that
    // PgBouncer is mid-connection with fails on dependencies, and re-running
    // this script is the documented way to ROTATE the password.
    await client.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${AUTH_USER}') THEN
           CREATE ROLE ${AUTH_USER} LOGIN;
         END IF;
       END
       $do$;`,
    );
    // Build the DDL with format(), then execute it — two statements, on purpose.
    //
    // This was one statement: a `DO $do$ ... EXECUTE format(..., $1) ... $do$`
    // with the password bound as a parameter. It could never have worked. A DO
    // block's body is a dollar-quoted STRING LITERAL, so `$1` inside it is text,
    // not a placeholder — Postgres parses the statement as taking no parameters
    // and rejects the bind:
    //
    //     bind message supplies 1 parameters, but prepared statement "" requires 0
    //
    // PL/pgSQL DO blocks cannot be parameterised at all. The failure was silent
    // in the worst way: the CREATE ROLE block above has no parameters, so it
    // succeeded, leaving a `pgbouncer` role with NO PASSWORD and no schema or
    // function behind it — a half-configured pooler that `--check` reports
    // accurately and a casual read of the log does not.
    //
    // The intent was right and is preserved: `format('%L')` does the literal
    // quoting in Postgres rather than interpolating a JS string into DDL, and
    // `%I` now does the same for the role name. The SELECT is parameterised, so
    // the password crosses the wire as a bound value; only the finished,
    // correctly-quoted DDL is executed.
    const { rows: ddlRows } = await client.query(
      "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS ddl",
      [AUTH_USER, AUTH_PASSWORD],
    );
    await client.query(ddlRows[0].ddl);

    await client.query("CREATE SCHEMA IF NOT EXISTS pgbouncer");

    // STRICT: a NULL username returns NULL instead of scanning. SECURITY
    // DEFINER: runs as the owning superuser so the lookup role never needs to be
    // one. search_path pinned to defeat any function-shadowing trick from a
    // caller-controlled path — a SECURITY DEFINER function with a mutable
    // search_path is a classic privilege-escalation vector.
    await client.query(`
      CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename text)
      RETURNS TABLE(username text, password text)
      LANGUAGE sql
      STABLE
      STRICT
      SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
      AS $fn$
        SELECT usename::text, passwd::text FROM pg_catalog.pg_shadow WHERE usename = p_usename;
      $fn$;
    `);

    await client.query("REVOKE ALL ON FUNCTION pgbouncer.get_auth(text) FROM PUBLIC");
    await client.query(`GRANT USAGE ON SCHEMA pgbouncer TO ${AUTH_USER}`);
    await client.query(`GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(text) TO ${AUTH_USER}`);

    // CONNECT, explicitly.
    //
    // Migration 0099 revoked CONNECT on this database from PUBLIC — a tenant
    // credential was able to open the platform database, which WS-S2's negative
    // test caught. That revoke also removes the default-open access this lookup
    // role would otherwise have inherited, and PgBouncer must connect here to
    // run auth_query.
    //
    // Granted here rather than in the migration so it sits next to the role's
    // creation: the two cannot drift apart, and enabling the pooler cannot
    // half-work in the way that produces an authentication error indis-
    // tinguishable from a database outage.
    await client.query(
      `DO $do$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '${AUTH_USER}'); END $do$;`,
    );

    // Prove it works now rather than discovering it at the first pooled
    // connection, when the symptom is an authentication error with no context.
    const { rows: probe } = await client.query(
      "SELECT username FROM pgbouncer.get_auth($1)",
      [config.DB_USER],
    );
    if (!probe.length) {
      console.warn(`WARNING: get_auth('${config.DB_USER}') returned no row.`);
      console.warn("The function exists but resolved nothing — check the role actually has a password set.");
    }

    console.warn(`PgBouncer auth_query ready.`);
    console.warn(`  role     : ${AUTH_USER} (password ${AUTH_PASSWORD ? "set" : "UNSET"})`);
    console.warn(`  function : pgbouncer.get_auth(text) SECURITY DEFINER, execute granted to ${AUTH_USER} only`);
    console.warn(`  probe    : resolved ${probe.length} row for ${config.DB_USER}`);
    console.warn("");
    console.warn("auth_query is ready. The pooler is NOT in the path yet, and should not be until:");
    console.warn("  - `npm run db:creds:verify` passes (per-tenant roles carry the search_path)");
    console.warn("  - `docker compose ps` shows the pgbouncer container actually Up");
    console.warn("  - the pooled path has been exercised somewhere that is not production");
    console.warn("");
    console.warn("Then set TENANT_DB_POOLER_HOST — that ONE variable, in a deploy that changes");
    console.warn("nothing else, so reverting is clearing it. Leave TENANT_DB_POOLER_PORT empty:");
    console.warn("it defaults to 6432 when the host is set, and setting it ALONE routed tenant");
    console.warn("connections to Postgres on the pooler's port on 2026-08-12 — an outage whose");
    console.warn("cause was a variable that looked inert.");
    console.warn("");
    console.warn("Migrations, provisioning and pg_dump keep connecting to Postgres directly — they");
    console.warn("need session state that transaction pooling does not preserve.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("setup-pgbouncer-auth failed:", err.message);
  process.exit(1);
});
