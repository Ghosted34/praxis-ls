#!/usr/bin/env node
/** Sandbox auto-wipe (kickoff §6): rebuild each tenant's sandbox schema; never
 *  touches live. Wire to cron. Thin wrapper over the provisioning service.
 *  Usage: node scripts/db/sandbox-wipe.js [--slug=smartls] */
"use strict";
const svc = require("../../src/services/platform/provisioning.service");
const a = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
}));
(async () => {
  const slugs = a.slug ? [a.slug] : await svc.listTenantSlugs();
  for (const slug of slugs) { await svc.wipeSandbox({ slug }); console.warn(`[praxis-db] sandbox rebuilt: ${slug}`); }
  console.warn(`[praxis-db] sandbox wipe complete for ${slugs.length} tenant(s) ✓`);
})().then(() => process.exit(0)).catch((e) => { console.error("[praxis-db] sandbox wipe FAILED:", e.message); process.exit(1); });
