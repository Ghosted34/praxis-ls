#!/usr/bin/env node
/**
 * Seed a tenant's SANDBOX schema with business test data (see the companion
 * scripts/tenant/seed-sandbox.sql for the full description + safety notes).
 *
 * Connects to the tenant DB and runs the SQL as one transaction. The SQL sets
 * `search_path = sandbox, public`, so it never touches the live schema, and it
 * is idempotent (no-ops if the marker entity 'SBX' already exists).
 *
 *   node scripts/tenant/seed-sandbox.js --slug=smartls
 *
 * To reseed from scratch: `npm run db:sandbox:wipe -- --slug=<slug>` first,
 * then run this again.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const m = require("../../src/services/platform/migrator");

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

const slug = args.slug;
if (!slug) {
  console.error("usage: node scripts/tenant/seed-sandbox.js --slug=<tenant-slug>");
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "seed-sandbox.sql"), "utf8");
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    await cli.query(sql);
    console.warn(`[praxis-db] sandbox seed applied to tenant '${slug}'`);
  } finally {
    await cli.end();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-db] sandbox seed FAILED:", e.message);
    process.exit(1);
  });
