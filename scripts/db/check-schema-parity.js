#!/usr/bin/env node
/**
 * Gate: a tenant's `sandbox` schema must enforce everything `live` does.
 *
 *   node scripts/db/check-schema-parity.js --slug=citenant
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Nothing in this repository ever compared the two schemas, and that is how a
 * single mistake survived 48 migrations and roughly two years.
 *
 * `pg_constraint` is DATABASE-wide and `conname` is unique per TABLE, so the
 * guard that half the migration set uses —
 *
 *     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_x')
 *
 * — matches that name on ANY schema's copy of the table. `provisioning.service`
 * migrates `live` first and `sandbox` second, so live created the constraint and
 * sandbox found live's row, took the branch as false, and skipped its own ADD.
 * A skipped ADD raises nothing, and most of these rules are also enforced by a
 * Zod validator on the write path, so no request ever reached the missing CHECK.
 * The audit that prompted 13791 measured 111 constraints missing from sandbox
 * across 48 tables.
 *
 * Every gate in `scripts/` is static — it reads files. This one needs a real
 * database, because the defect is not visible in any single file: each of those
 * 48 migrations is individually correct-looking, and only the ORDER they run in
 * produces the divergence. So it runs in CI's `migrations` job, against the
 * tenant that job already provisions from nothing.
 *
 * ── WHAT IT ASSERTS ────────────────────────────────────────────────────────
 *
 *   1. No CHECK or FOREIGN KEY exists in `live` and not in `sandbox`.
 *   2. No `sandbox` constraint REFERENCES the `live` schema. That is the failure
 *      mode a careless repair introduces — a foreign key pointing from test data
 *      at production rows — and it is worse than the gap it would be fixing.
 *   3. Every table in `live` exists in `sandbox`. A table that only exists in
 *      one schema is the same class of bug one level up.
 *
 * Indexes and triggers are deliberately NOT compared yet. They diverge for
 * legitimate reasons (sandbox is wiped and rebuilt, and some indexes are
 * created outside the migration set), and a gate that cries wolf is a gate
 * somebody switches off. Constraints are the ones that were actually lost.
 */
"use strict";

const { Client } = require("pg");
const { config } = require("../../src/config/env");

const args = process.argv.slice(2);
const SLUG = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || "citenant";
const REF = "live";
const TARGET = "sandbox";

const q = {
  /** CHECK and FOREIGN KEY constraints per schema, as (table, name) pairs. */
  constraints: `
    SELECT n.nspname AS schema, t.relname AS tbl, c.conname AS name,
           pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE n.nspname = ANY($1) AND c.contype IN ('c','f')`,
  tables: `
    SELECT n.nspname AS schema, t.relname AS tbl
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ANY($1) AND t.relkind = 'r'`,
};

function connect() {
  const t = config.tenantDb || {};
  return new Client({
    host: t.hostDefault || process.env.TENANT_DB_HOST_DEFAULT || "localhost",
    port: Number(t.portDefault || process.env.TENANT_DB_PORT_DEFAULT || 5432),
    user: t.superuser || process.env.TENANT_DB_SUPERUSER,
    password: t.superuserPassword || process.env.TENANT_DB_SUPERUSER_PASSWORD,
    database: `tenant_${SLUG}`,
  });
}

async function main() {
  const cli = connect();
  await cli.connect();
  let failures = 0;
  try {
    const { rows: cons } = await cli.query(q.constraints, [[REF, TARGET]]);
    const { rows: tabs } = await cli.query(q.tables, [[REF, TARGET]]);

    const key = (r) => `${r.tbl}.${r.name}`;
    const inTarget = new Set(cons.filter((r) => r.schema === TARGET).map(key));
    const missing = cons.filter((r) => r.schema === REF && !inTarget.has(key(r)));

    const targetTables = new Set(tabs.filter((r) => r.schema === TARGET).map((r) => r.tbl));
    const missingTables = tabs
      .filter((r) => r.schema === REF && !targetTables.has(r.tbl))
      .map((r) => r.tbl);

    // A sandbox constraint naming the live schema is a cross-schema reference:
    // test rows depending on production rows.
    const crossed = cons.filter(
      (r) => r.schema === TARGET && new RegExp(`\\b${REF}\\.`).test(r.def),
    );

    if (missingTables.length) {
      failures += 1;
      console.error(
        `\n✗ ${missingTables.length} table(s) in ${REF} are absent from ${TARGET}:`,
      );
      for (const t of missingTables.slice(0, 20)) console.error(`    ${t}`);
    }

    if (missing.length) {
      failures += 1;
      console.error(
        `\n✗ ${missing.length} constraint(s) enforced in ${REF} but NOT in ${TARGET}.` +
          `\n  ${TARGET} accepts rows ${REF} would reject, so a test can pass on data` +
          `\n  production would refuse. Almost always a migration guard that reads` +
          `\n  pg_constraint by conname alone — see 13791 for the shape that works.\n`,
      );
      for (const r of missing.slice(0, 30)) console.error(`    ${r.tbl}.${r.name}`);
      if (missing.length > 30) console.error(`    … and ${missing.length - 30} more`);
    }

    if (crossed.length) {
      failures += 1;
      console.error(
        `\n✗ ${crossed.length} ${TARGET} constraint(s) reference the ${REF} schema —` +
          `\n  test data wired to production rows:\n`,
      );
      for (const r of crossed.slice(0, 20)) console.error(`    ${r.tbl}.${r.name}: ${r.def}`);
    }

    if (!failures) {
      const n = cons.filter((r) => r.schema === REF).length;
      console.log(
        `Schema parity OK — ${TARGET} enforces all ${n} CHECK/FK constraint(s) that ${REF} does, ` +
          `across ${targetTables.size} tables.`,
      );
    }
  } finally {
    await cli.end();
  }
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("check-schema-parity FAILED:", e.message || e);
  process.exit(1);
});
