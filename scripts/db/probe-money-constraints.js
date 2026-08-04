#!/usr/bin/env node
/**
 * Find rows that violate the money/quantity constraints added in 0497.
 *
 *   node scripts/db/probe-money-constraints.js               # all tenants
 *   node scripts/db/probe-money-constraints.js --slug=smartls
 *   node scripts/db/probe-money-constraints.js --sql         # print VALIDATE statements
 *
 * WHY THIS EXISTS
 *
 * Migration 0497 adds every CHECK as NOT VALID: enforced on new writes from the
 * moment it lands, but the existing table is never scanned. That is deliberate —
 * it means the migration cannot fail on historical bad data and the bleeding
 * stops immediately.
 *
 * It also means the constraints are only half-true. Until each is VALIDATEd, the
 * schema claims a rule that the existing rows may not obey, and a report that
 * reads those rows still returns a negative invoice total. This script closes
 * that gap: it tells you exactly which rows are wrong, in which tenant, before
 * anyone runs VALIDATE and gets a failure they cannot interpret.
 *
 * READ-ONLY. It never writes. Fixing a negative invoice total is an accounting
 * decision — a correcting entry, not an UPDATE — and belongs to whoever signs
 * the accounts.
 *
 * Exit 1 when violations exist, so it can gate a close checklist.
 */
"use strict";

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const { config } = require("../../src/config/env");

const args = process.argv.slice(2);
const SLUG = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || null;
const PRINT_SQL = args.includes("--sql");

/** Parse the constraints straight out of the migration, so the two cannot drift. */
function constraintsFromMigration() {
  const file = path.resolve(__dirname, "../../migrations/tenant/0497_money_constraints.sql");
  const sql = fs.readFileSync(file, "utf8");
  const out = [];
  const re = /^ALTER TABLE (\w+) ADD CONSTRAINT (\w+)\s*\n?\s*CHECK \((.+?)\) NOT VALID;/gms;
  let m;
  while ((m = re.exec(sql))) {
    out.push({ table: m[1], name: m[2], expr: m[3].replace(/\s+/g, " ").trim() });
  }
  return out;
}

async function probeTenant(slug, constraints) {
  const cli = new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database: `tenant_${slug}`,
    user: config.TENANT_DB_SUPERUSER,
    password: config.TENANT_DB_SUPERUSER_PASSWORD,
  });
  await cli.connect();
  const findings = [];
  try {
    for (const schema of ["live", "sandbox"]) {
      await cli.query(`SET search_path = ${schema}, public`);
      for (const c of constraints) {
        try {
          // NOT the constraint expression — its NEGATION. A CHECK passes when
          // the expression is true, so a violating row is one where it is false.
          // NULL is not a violation: a CHECK is satisfied by NULL.
          const { rows } = await cli.query(
            `SELECT COUNT(*)::int AS n FROM ${c.table} WHERE NOT (${c.expr})`,
          );
          if (rows[0].n > 0) findings.push({ schema, ...c, count: rows[0].n });
        } catch (err) {
          // A table that does not exist in this tenant yet is not a finding.
          if (!/does not exist/i.test(err.message)) {
            findings.push({ schema, ...c, error: err.message });
          }
        }
      }
    }
  } finally {
    await cli.end();
  }
  return findings;
}

(async () => {
  const constraints = constraintsFromMigration();
  if (!constraints.length) {
    console.error("No constraints parsed from 0497 — has the migration moved?");
    process.exit(2);
  }
  console.log(`Probing ${constraints.length} constraints.\n`);

  let tenants;
  if (SLUG) {
    tenants = [{ slug: SLUG }];
  } else {
    const platform = new Client({
      host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
      user: config.DB_USER, password: config.DB_PASSWORD,
    });
    await platform.connect();
    try {
      const { rows } = await platform.query(
        "SELECT slug FROM platform.tenant WHERE status = 'LIVE' ORDER BY slug",
      );
      tenants = rows;
    } finally {
      await platform.end();
    }
  }

  let total = 0;
  const clean = [];

  for (const { slug } of tenants) {
    let findings;
    try {
      findings = await probeTenant(slug, constraints);
    } catch (err) {
      console.log(`[${slug}] SKIPPED — ${err.message}`);
      continue;
    }
    const violations = findings.filter((f) => f.count);
    const errors = findings.filter((f) => f.error);

    if (!violations.length && !errors.length) {
      clean.push(slug);
      continue;
    }
    console.log(`[${slug}]`);
    for (const v of violations) {
      console.log(`   ${String(v.count).padStart(6)} row(s)  ${v.schema}.${v.table}  ${v.expr}`);
      total += v.count;
    }
    for (const e of errors) console.log(`   ! could not probe ${e.schema}.${e.table}: ${e.error}`);
    console.log("");
  }

  if (clean.length) console.log(`Clean: ${clean.join(", ")}\n`);

  console.log("─".repeat(72));
  if (total === 0) {
    console.log("No violations. Every constraint in 0497 can be VALIDATEd safely.\n");
    if (PRINT_SQL) {
      console.log("Run against each tenant database, with search_path set per schema:\n");
      for (const c of constraints) {
        console.log(`ALTER TABLE ${c.table} VALIDATE CONSTRAINT ${c.name};`);
      }
    } else {
      console.log("Re-run with --sql to print the VALIDATE statements.");
    }
    process.exit(0);
  }

  console.log(`${total} row(s) violate a constraint that is currently NOT VALID.`);
  console.log("");
  console.log("These rows predate the constraint and are still readable by every report");
  console.log("in the product — a negative invoice total shows up in the trial balance");
  console.log("exactly as it is stored.");
  console.log("");
  console.log("This script does NOT fix them. Correcting a money figure is an accounting");
  console.log("decision (a correcting entry, not an UPDATE) and belongs to whoever signs");
  console.log("the accounts. Once they are resolved, VALIDATE each constraint — it takes");
  console.log("only a SHARE UPDATE EXCLUSIVE lock and does not block reads or writes.");
  process.exit(1);
})().catch((err) => {
  console.error("probe-money-constraints failed:", err.message);
  process.exit(2);
});
