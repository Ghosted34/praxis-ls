#!/usr/bin/env node
/**
 * Rebuild ai_action_catalogue from the *.ai.js manifests (AI_ARCHITECTURE §2).
 *   node scripts/ai/sync-actions.js --tenant=smartls     # one tenant (live schema)
 *   node scripts/ai/sync-actions.js --all                # every provisioned tenant
 *   node scripts/ai/sync-actions.js --dry                # print the catalogue, no writes
 * Idempotent upsert by action_key; ai_enabled follows the executor registry so
 * the catalogue never advertises a capability the runtime can't safely run.
 */
"use strict";

const m = require("../../src/services/platform/migrator");
const provisioning = require("../../src/services/platform/provisioning.service");
const registrar = require("../../src/services/ai/action-registrar");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

async function syncTenant(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    // Sync BOTH schemas: business data (incl. ai_action_catalogue) is served from
    // `live` or `sandbox` depending on X-Praxis-Env (see middleware/tenant-context).
    // Live-only sync left the copilot in TEST mode with just the seed actions.
    const schemas = ["live"];
    const { rows } = await cli.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sandbox'");
    if (rows.length) schemas.push("sandbox");
    for (const schema of schemas) {
      await cli.query(`SET search_path = ${schema}, public`); // eslint-disable-line no-await-in-loop
      const r = await registrar.syncCatalogue(cli); // eslint-disable-line no-await-in-loop
      console.warn(`[praxis-ai] tenant ${slug} (${schema}): ${r.upserts}/${r.total} catalogue actions synced`);
    }
  } finally {
    await cli.end();
  }
}

async function main() {
  if (a.dry) {
    const rows = registrar.buildCatalogue();
    console.warn(`[praxis-ai] ${rows.length} actions (${rows.filter((r) => r.is_write).length} writes, ${rows.filter((r) => r.ai_enabled).length} ai_enabled)`);
    for (const r of rows) console.warn(`  ${r.ai_enabled ? "•" : " "} ${r.action_key}${r.is_write ? " [write]" : ""}${r.required_permission ? " (" + r.required_permission + ")" : ""}`);
    return;
  }
  if (a.tenant) return syncTenant(a.tenant);
  if (a.all) {
    const slugs = await provisioning.listTenantSlugs();
    for (const s of slugs) await syncTenant(s); /// eslint-disable-line no-await-in-loop
    return;
  }
  console.error("usage: sync-actions.js --tenant=<slug> | --all | --dry");
  process.exit(1);
}

main().catch((err) => { console.error("[praxis-ai] sync failed:", err.message); process.exit(1); });
