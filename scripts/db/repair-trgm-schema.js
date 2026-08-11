#!/usr/bin/env node
/**
 * Repair: move `pg_trgm` into `public` on tenant databases that have it
 * elsewhere.
 *
 * THE TRAP, which migration 0504 documents at length
 *
 *   The migrator runs each tenant file once per schema with
 *   `search_path = <schema>,public`. A bare `CREATE EXTENSION IF NOT EXISTS
 *   pg_trgm` therefore installs the extension into whichever schema ran FIRST —
 *   `live`. Extensions are database-wide objects, so the SANDBOX pass then finds
 *   `IF NOT EXISTS` already satisfied while `gin_trgm_ops` sits in a schema that
 *   is not on its search_path:
 *
 *       operator class "gin_trgm_ops" does not exist for access method "gin"
 *
 *   0504 and 0633 were fixed to say `SCHEMA public` explicitly. Migration 0514
 *   predates that and uses a bare, unqualified `gin_trgm_ops`, so any database
 *   that acquired the extension into `live` before the fix cannot apply 0514 to
 *   its sandbox schema.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 *
 *   A migration numbered above 0514 runs AFTER it and would be too late, and
 *   renumbering an applied migration is forbidden (the ledger keys on filename).
 *   The repair has to happen out of band, before the failing file is retried.
 *
 *   Written in Node against the `pg` client already in node_modules rather than
 *   as a `psql` one-liner: psql is not on PATH on a typical Windows dev machine,
 *   and this needs to run identically there, in CI, and in the container.
 *
 *   Idempotent and safe: it only ever MOVES an existing extension, never drops
 *   or recreates one, and it skips any database where it is already in public.
 *
 *   node scripts/db/repair-trgm-schema.js            # every live tenant
 *   node scripts/db/repair-trgm-schema.js --slug=x   # one
 *   node scripts/db/repair-trgm-schema.js --check    # report only, change nothing
 */
"use strict";

const m = require("../../src/services/platform/migrator");
const registry = require("../../src/services/tenant/registry.service");
const platformDb = require("../../src/services/platform/db");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const CHECK_ONLY = has("--check");
const SLUG = val("slug");

async function repairOne(slug, dbName) {
  const cli = m.client(dbName, { superuser: true });
  await cli.connect();
  try {
    const { rows } = await cli.query(
      `SELECT n.nspname AS schema
         FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm'`,
    );

    if (!rows.length) {
      // Nothing to move. A later migration's `CREATE EXTENSION ... SCHEMA
      // public` will install it correctly.
      return { slug, state: "absent", action: "none" };
    }

    const schema = rows[0].schema;
    if (schema === "public") return { slug, state: "public", action: "none" };

    if (CHECK_ONLY) return { slug, state: schema, action: "would move to public" };

    await cli.query("ALTER EXTENSION pg_trgm SET SCHEMA public");
    return { slug, state: schema, action: "moved to public" };
  } finally {
    await cli.end();
  }
}

(async () => {
  let failed = 0;
  let moved = 0;
  try {
    const all = await registry.listActiveTenants();
    const targets = SLUG ? all.filter((t) => t.slug === SLUG) : all;
    if (!targets.length) throw new Error(SLUG ? `no live tenant "${SLUG}"` : "no live tenants");

    for (const t of targets) {
      try {
        const r = await repairOne(t.slug, t.db_name);
        console.warn(`${t.slug.padEnd(12)} pg_trgm in "${r.state}" — ${r.action}`);
        if (r.action.startsWith("moved")) moved++;
      } catch (err) {
        console.warn(`${t.slug.padEnd(12)} FAILED — ${err.message}`);
        failed++;
      }
    }

    if (CHECK_ONLY) {
      console.warn("\nCheck only — nothing was changed.");
    } else if (moved) {
      console.warn(`\n${moved} database(s) repaired. Now run: npm run db:migrate:tenants`);
    } else {
      console.warn("\nNothing to repair.");
    }
  } catch (err) {
    console.warn(`error: ${err.message}`);
    failed++;
  } finally {
    await registry.closeAll().catch(() => {});
    await platformDb.close().catch(() => {});
  }
  process.exitCode = failed ? 1 : 0;
})();
