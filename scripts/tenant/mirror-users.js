#!/usr/bin/env node
/**
 * Backfill `sandbox.app_user` from `live.app_user` for one tenant or all of them.
 *
 * WHY. Identity is pinned to the LIVE schema while business data writes to the
 * env-selected one, and 60+ tenant columns are `REFERENCES app_user(user_id)`, so
 * a user missing from sandbox makes that user's TEST-mode writes fail with 23503
 * ("Referenced record not found") — typically after the business row has already
 * committed. Mirroring now happens automatically on user create (see
 * src/shared/db/sandbox-user-mirror.js), but tenants provisioned before that, and
 * any user created between the last sandbox wipe and today, need this one-off pass.
 *
 * Read-only with respect to LIVE. Idempotent — re-running inserts nothing new.
 *
 *   node scripts/tenant/mirror-users.js --slug=smartls
 *   node scripts/tenant/mirror-users.js --all
 *   node scripts/tenant/mirror-users.js --all --dry-run
 */
"use strict";

const { config } = require("../../src/config/env");
const m = require("../../src/services/platform/migrator");
const {
  mirrorUsersIntoSandbox,
} = require("../../src/shared/db/sandbox-user-mirror");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

async function listSlugs() {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const { rows } = await pf.query(
      "SELECT slug FROM platform.tenant WHERE status IN ('LIVE','PROVISIONING','SUSPENDED') ORDER BY slug",
    );
    return rows.map((r) => r.slug);
  } finally {
    await pf.end();
  }
}

/** How many live users have no sandbox counterpart — the size of the problem. */
async function countMissing(cli) {
  const { rows } = await cli.query(
    `SELECT count(*)::int AS n FROM live.app_user l
      WHERE NOT EXISTS (SELECT 1 FROM sandbox.app_user s WHERE s.user_id = l.user_id)`,
  );
  return rows[0].n;
}

async function run(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    const { rows } = await cli.query(
      "SELECT to_regclass('sandbox.app_user') IS NOT NULL AS ok",
    );
    if (!rows[0] || rows[0].ok !== true) {
      console.warn(`[praxis] ${slug}: no sandbox.app_user — run db:migrate:tenants first`);
      return;
    }
    const missing = await countMissing(cli);
    if (a["dry-run"]) {
      console.warn(`[praxis] ${slug}: ${missing} user(s) missing from sandbox (dry run)`);
      return;
    }
    const res = await mirrorUsersIntoSandbox(cli);
    const left = await countMissing(cli);
    // `left > 0` after a mirror means an email collision with a differently-
    // identified sandbox row — the one case the ON CONFLICT swallows without
    // satisfying the FK. Worth naming rather than reporting success.
    const tail = left > 0 ? ` — ⚠️ ${left} still missing (conflicting sandbox rows)` : "";
    console.warn(`[praxis] ${slug}: mirrored ${res.mirrored} of ${missing} missing user(s)${tail}`);
  } finally {
    await cli.end();
  }
}

async function main() {
  if (!a.slug && !a.all) throw new Error("--slug=<slug> or --all is required");
  const slugs = a.all ? await listSlugs() : [a.slug];
  for (const slug of slugs) await run(slug);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] mirror-users FAILED:", e.message);
    process.exit(1);
  });
