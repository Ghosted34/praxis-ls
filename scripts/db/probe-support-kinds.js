#!/usr/bin/env node
/**
 * Every ticket kind and status the API accepts must be accepted by the
 * platform database too.
 *
 *   node scripts/db/probe-support-kinds.js
 *
 * ── THE BUG THIS EXISTS TO CATCH ────────────────────────────────────────────
 *
 * 0105 widened `platform.support_ticket.kind` from three kinds to nine by
 * dropping the old CHECK and adding a wider one. It dropped the wrong NAME —
 * an unnamed column CHECK is called `<table>_<column>_check`, with no schema in
 * it, and the DROP looked for a `platform_`-prefixed name that never existed.
 * `DROP ... IF EXISTS` says `skipping` and succeeds, so the migration passed,
 * and the table ended up carrying BOTH CHECKs.
 *
 * Two CHECKs on a column are ANDed. The effective set stayed three kinds, and
 * raising a ticket as URGENT failed in production with SQLSTATE 23514 —
 * "A value violates a domain constraint" — while every gate was green.
 *
 * ── WHY IT INSERTS RATHER THAN READING pg_constraint ────────────────────────
 *
 * Reading the constraint definition would have MISSED this. There was a
 * constraint on that column whose definition listed all nine kinds, and it was
 * real and correct; it was the SECOND, stale one beside it that did the
 * rejecting. Only actually writing a row tests what the database enforces,
 * which is every constraint on the column at once.
 *
 * Every write happens inside a transaction that is ALWAYS rolled back, so this
 * is safe to run against any environment, including production.
 *
 * ── WHY THIS IS A PROBE AND NOT A UNIT TEST ─────────────────────────────────
 *
 * The unit suite mocks the platform DB with an in-memory Map, which enforces no
 * constraints at all — the twelve tests covering this feature all passed while
 * six of its nine kinds were unusable. A constraint is a database fact and only
 * a database can be asked about it.
 *
 * Exit 1 if the database rejects anything the API would accept.
 */
"use strict";

const { Client } = require("pg");
const { config } = require("../../src/config/env");
const { KINDS } = require("../../src/modules/dashboard/support/support.validator");
const { STATUSES } = require("../../src/services/platform/support.service");

/** Values the API accepts, by column. The DB must accept all of them. */
const EXPECTED = [
  { column: "kind", values: KINDS, source: "support.validator KINDS" },
  { column: "status", values: STATUSES, source: "platform support.service STATUSES" },
];

async function probeColumn(client, column, values, tenantId) {
  const rejected = [];
  for (const value of values) {
    await client.query("SAVEPOINT probe");
    try {
      await client.query(
        `INSERT INTO platform.support_ticket (tenant_id, title, ${column}) VALUES ($1,$2,$3)`,
        [tenantId, `probe ${column}=${value}`, value],
      );
      await client.query("RELEASE SAVEPOINT probe");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT probe");
      rejected.push({ value, code: err.code, constraint: err.constraint, message: err.message });
    }
  }
  return rejected;
}

(async () => {
  const client = new Client({
    host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  let failures = 0;
  try {
    // Everything below is rolled back. Nothing this script writes survives it.
    await client.query("BEGIN");

    let { rows } = await client.query("SELECT tenant_id FROM platform.tenant LIMIT 1");
    if (!rows[0]) {
      ({ rows } = await client.query(
        "INSERT INTO platform.tenant (slug, legal_name, display_name) " +
          "VALUES ('probe-kinds','Probe','Probe') RETURNING tenant_id",
      ));
    }
    const tenantId = rows[0].tenant_id;

    for (const { column, values, source } of EXPECTED) {
      const rejected = await probeColumn(client, column, values, tenantId);
      if (!rejected.length) {
        console.warn(`✓ platform.support_ticket.${column}: all ${values.length} accepted (${source})`);
        continue;
      }
      failures += rejected.length;
      console.error(`\n✗ platform.support_ticket.${column}: the database rejects ${rejected.length} of ${values.length} value(s) the API accepts.\n`);
      console.error(`  The API's list is ${source}.\n`);
      for (const r of rejected) {
        console.error(`    ${r.value.padEnd(10)} → ${r.code} ${r.constraint || ""}`);
      }
      const { rows: checks } = await client.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
           JOIN pg_class t     ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname='platform' AND t.relname='support_ticket' AND c.contype='c'
            AND pg_get_constraintdef(c.oid) LIKE $1`,
        [`%${column}%`],
      );
      console.error(`\n  CHECK constraints currently on that column (a row must satisfy ALL of them):\n`);
      for (const c of checks) console.error(`    ${c.conname}\n      ${c.def}`);
      console.error(
        "\n  If one of these is a stale copy the widening migration failed to drop,\n" +
          "  it is almost certainly a NAME mismatch: Postgres calls an unnamed column\n" +
          "  CHECK `<table>_<column>_check`, with NO schema prefix, so a DROP naming\n" +
          "  `<schema>_<table>_<column>_check` silently skips and leaves it in place.\n" +
          "  See migrations/platform/0106 for the repair.\n",
      );
    }
  } finally {
    // Unconditional: the probe never leaves a row behind, on any exit path.
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }

  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error("probe-support-kinds failed:", err.message);
  process.exit(2);
});
