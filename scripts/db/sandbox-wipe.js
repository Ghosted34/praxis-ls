#!/usr/bin/env node
/** Sandbox wipe (kickoff §6): rebuild a tenant's sandbox schema; never touches
 *  live. Thin wrapper over the provisioning service. Every run writes a
 *  `sandbox.wiped` row to platform.platform_audit with source `cli`.
 *
 *  Usage: node scripts/db/sandbox-wipe.js --slug=smartls
 *         node scripts/db/sandbox-wipe.js --all      # every LIVE/PROVISIONING tenant
 *
 *  --all is now explicit. This script used to wipe the WHOLE FLEET when called
 *  with no arguments, which is the wrong default for a destructive command —
 *  and it was wired to cron, which is how a fleet-wide nightly rebuild became
 *  possible in the first place. Wipes are manual now (SANDBOX_WIPE_CRON is
 *  empty by default); do not re-wire this to cron without a decision. */
"use strict";
const svc = require("../../src/services/platform/provisioning.service");
const a = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
}));
(async () => {
  if (!a.slug && !a.all) {
    console.error("[praxis-db] refusing to wipe: pass --slug=<tenant> or --all");
    process.exit(2);
  }
  const slugs = a.slug ? [a.slug] : await svc.listTenantSlugs();
  for (const slug of slugs) {
    const out = await svc.wipeSandbox({ slug, source: "cli" });
    console.warn(`[praxis-db] sandbox rebuilt: ${slug}${out.audited ? "" : " (AUDIT ROW FAILED — see logs)"}`);
  }
  console.warn(`[praxis-db] sandbox wipe complete for ${slugs.length} tenant(s) ✓`);
})().then(() => process.exit(0)).catch((e) => { console.error("[praxis-db] sandbox wipe FAILED:", e.message); process.exit(1); });
