#!/usr/bin/env node
/**
 * Provision a tenant (create DB, migrate live+sandbox, seed, register, project
 * features). Thin CLI wrapper over the provisioning service.
 *   npm run db:provision -- --slug=smartls --name="Smart Logistics" [--plan=full] [--subdomain=host]
 */
"use strict";

const { provisionTenant } = require("../../src/services/platform/provisioning.service");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

provisionTenant({
  slug: a.slug,
  name: a.name,
  plan: a.plan || "full",
  subdomain: a.subdomain,
})
  .then((r) => {
    console.warn(`[praxis-db] tenant '${r.slug}' provisioned -> ${r.dbName} @ ${r.host}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[praxis-db] provisioning FAILED:", (e.message || e.code || String(e)) + (e && e.errors ? " — " + e.errors.map((x) => x.message || x.code).join("; ") : ""));
    process.exit(1);
  });
