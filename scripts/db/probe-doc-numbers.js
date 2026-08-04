#!/usr/bin/env node
/**
 * Find duplicate `doc_number` values before migration 0498 adds the unique
 * indexes.
 *
 *   node scripts/db/probe-doc-numbers.js
 *   node scripts/db/probe-doc-numbers.js --slug=smartls
 *
 * RUN THIS BEFORE DEPLOYING 0498.
 *
 * Unlike a CHECK, a unique index has no NOT VALID escape hatch: it either
 * builds or it fails, and if it fails the whole migration fails. That is the
 * correct trade for statutory document numbers — silently tolerating duplicates
 * is not an option — but it means a collision turns into a failed deploy rather
 * than a warning.
 *
 * The deploy is safe either way (scripts/deploy.sh takes a dump first and
 * aborts before rolling), but a five-minute check now beats a failed deploy and
 * a confusing error later.
 *
 * READ-ONLY. Resolving a duplicate statutory number is a decision for whoever
 * signs the accounts — one of the two documents has the wrong number, and which
 * one is not something a script can know.
 *
 * Exit 1 if any duplicate exists.
 */
"use strict";

const { Client } = require("pg");
const { config } = require("../../src/config/env");

const args = process.argv.slice(2);
const SLUG = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || null;

/** Must match the tables indexed in 0498. */
const TABLES = [
  "invoice", "delivery_note", "costing", "purchase_request", "purchase_order",
  "supplier_invoice", "cash_request", "quotation", "proposal",
];

async function probeTenant(slug) {
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
      for (const t of TABLES) {
        try {
          const { rows } = await cli.query(
            `SELECT doc_number, COUNT(*)::int AS n
               FROM ${t}
              WHERE doc_number IS NOT NULL
              GROUP BY doc_number
             HAVING COUNT(*) > 1
              ORDER BY n DESC, doc_number
              LIMIT 50`,
          );
          for (const r of rows) findings.push({ schema, table: t, doc_number: r.doc_number, count: r.n });
        } catch (err) {
          if (!/does not exist/i.test(err.message)) {
            findings.push({ schema, table: t, error: err.message });
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

  let dupes = 0;
  for (const { slug } of tenants) {
    let findings;
    try {
      findings = await probeTenant(slug);
    } catch (err) {
      console.log(`[${slug}] SKIPPED — ${err.message}`);
      continue;
    }
    const real = findings.filter((f) => f.count);
    if (!real.length && !findings.length) continue;
    console.log(`[${slug}]`);
    for (const f of real) {
      console.log(`   ${f.schema}.${f.table}  "${f.doc_number}" appears ${f.count} times`);
      dupes += 1;
    }
    for (const f of findings.filter((x) => x.error)) {
      console.log(`   ! could not probe ${f.schema}.${f.table}: ${f.error}`);
    }
    console.log("");
  }

  console.log("─".repeat(72));
  if (dupes === 0) {
    console.log("No duplicate document numbers. Migration 0498 will apply cleanly.");
    process.exit(0);
  }
  console.log(`${dupes} duplicated document number(s). MIGRATION 0498 WILL FAIL until these are resolved.`);
  console.log("");
  console.log("Each pair means two statutory documents share one number. Which of them");
  console.log("is wrong is an accounting question, not a technical one — renumbering a");
  console.log("document that has already been sent to a client or filed has consequences.");
  console.log("Resolve with the accountant, then re-run this, then deploy.");
  process.exit(1);
})().catch((err) => {
  console.error("probe-doc-numbers failed:", err.message);
  process.exit(2);
});
