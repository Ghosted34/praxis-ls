#!/usr/bin/env node
/**
 * Upgrade EXISTING tenants — apply any new tenant migrations to every tenant's
 * live + sandbox schemas (idempotent via the migration ledger). Run after adding
 * migration files.
 *   node scripts/db/migrate-tenants.js            # all tenants
 *   node scripts/db/migrate-tenants.js --slug=smartls
 */
"use strict";

const svc = require("../../src/services/platform/provisioning.service");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

(async () => {
  const results = a.slug
    ? [await svc.migrateTenant(a.slug)]
    : await svc.migrateAllTenants();
  for (const r of results) {
    console.warn(`[praxis-db] ${r.slug}: applied ${r.applied} new file(s)`);
  }
  console.warn(
    `[praxis-db] tenant upgrade complete for ${results.length} tenant(s)`,
  );
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-db] tenant upgrade FAILED:", (e.message || e.code || String(e)) + (e && e.errors ? " — " + e.errors.map((x) => x.message || x.code).join("; ") : ""));
    process.exit(1);
  });
