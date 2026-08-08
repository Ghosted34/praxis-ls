#!/usr/bin/env node
/**
 * Which schema version is each tenant actually on?
 *
 * DATA 3.2 (High). A partial fleet upgrade leaves tenants on different schema
 * versions, and until now there was no way to ask which. `migrateAllTenants`
 * aborted on the first failure, so the fleet split at an arbitrary point and
 * nothing recorded where — you found out when one tenant started throwing 42703
 * from inside a feature, hours later.
 *
 *   node scripts/db/fleet-status.js          # human-readable table
 *   node scripts/db/fleet-status.js --json   # for a monitor or a script
 *
 * Exit 1 when any tenant is behind or unreachable, so this can be a deploy gate
 * as well as a diagnostic. Read-only.
 */
"use strict";

const { fleetSchemaStatus } = require("../../src/services/platform/provisioning.service");

const JSON_OUT = process.argv.includes("--json");

(async () => {
  const status = await fleetSchemaStatus();

  if (JSON_OUT) {
    console.warn(JSON.stringify(status, null, 2));
    process.exit(status.drifted ? 1 : 0);
  }

  console.warn(`Expected live migrations: ${status.expected}\n`);
  const w = Math.max(6, ...status.tenants.map((t) => t.slug.length));
  console.warn(`${"tenant".padEnd(w)}  applied  behind  latest`);
  console.warn("-".repeat(w + 40));

  for (const t of status.tenants) {
    if (t.error) {
      console.warn(`${t.slug.padEnd(w)}  UNREACHABLE — ${t.error}`);
      continue;
    }
    const flag = t.behind > 0 ? " <-- BEHIND" : "";
    console.warn(
      `${t.slug.padEnd(w)}  ${String(t.applied).padStart(7)}  ${String(t.behind).padStart(6)}  ${t.latest || "-"}${flag}`,
    );
  }

  console.warn("");
  if (!status.drifted) {
    console.warn("Every tenant is on the same schema version.");
    process.exit(0);
  }

  if (status.behind.length) {
    console.warn(`${status.behind.length} tenant(s) behind: ${status.behind.join(", ")}`);
    console.warn("  Bring them up:  node scripts/db/migrate-tenants.js --slug=<slug>");
  }
  if (status.unreachable.length) {
    console.warn(`${status.unreachable.length} tenant(s) unreachable: ${status.unreachable.join(", ")}`);
    console.warn("  Unreachable is not the same as behind — check the database is up before migrating.");
  }
  console.warn("");
  console.warn("A mixed fleet is not automatically an emergency, but it is never intentional.");
  process.exit(1);
})().catch((err) => {
  console.error(`fleet-status failed: ${err.message}`);
  process.exit(2);
});
