#!/usr/bin/env node
/**
 * Find depreciation the fixed-asset register claims is in the GL but is not.
 *
 *   node scripts/db/reconcile-depreciation.js               # all tenants, report only
 *   node scripts/db/reconcile-depreciation.js --slug=smartls
 *   node scripts/db/reconcile-depreciation.js --fix         # clear the false posted flags
 *
 * WHY THIS EXISTS — audit DATA 5.5, and the damage it left behind.
 *
 * `asset.service.depreciate()` built its journal lines with `account:` while
 * buildAndInsert reads `account_code`, and passed no `sourceDocRef` while the
 * validator requires one. Every call threw. A `catch { entryId = null }`
 * swallowed it and `markPosted()` then set `posted = true, entry_id = NULL`.
 *
 * The code is fixed (commit 62a9646). THE DATA IS NOT. Every depreciation run
 * before that fix is a row saying "posted" with no journal entry behind it, and
 * `repo.accumulatedPosted()` sums `WHERE posted = true` — so:
 *
 *   · the fixed-asset register reports accumulated depreciation the trial
 *     balance does not contain
 *   · net book value is understated by the same amount
 *   · dispose() computes gain/loss from that phantom figure
 *   · the two numbers will never reconcile, and nothing in the product says why
 *
 * This is read-only by default. Run it before period close.
 *
 * WHAT --fix DOES, AND DOES NOT
 *   It sets `posted = false` on rows with `entry_id IS NULL`, which makes the
 *   register tell the truth: those periods are UNPOSTED. They can then be
 *   re-posted through the normal `depreciate()` path, which now works.
 *
 *   It does NOT invent journal entries. Back-dating postings into closed
 *   periods is an accounting decision with tax consequences (OHADA period
 *   locks exist for a reason) and belongs to whoever signs the accounts, not
 *   to a repair script.
 *
 *   Re-posting a corrected period may be blocked by the period lock. That is
 *   the ledger working correctly. Talk to the accountant about whether it
 *   belongs in the current period as a prior-period adjustment.
 */
"use strict";

const { Client } = require("pg");
const { config } = require("../../src/config/env");

const args = process.argv.slice(2);
const FIX = args.includes("--fix");
const SLUG = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1] || null;

const FIND = `
  SELECT d.depreciation_id, d.asset_id, d.period_code, d.amount,
         a.label, a.tag, a.status AS asset_status
    FROM depreciation_schedule d
    JOIN asset a ON a.asset_id = d.asset_id
   WHERE d.posted = true
     AND d.entry_id IS NULL
   ORDER BY a.label, d.period_code
`;

async function tenantList(platform) {
  if (SLUG) return [{ slug: SLUG }];
  const { rows } = await platform.query(
    "SELECT slug FROM platform.tenant WHERE status <> 'ARCHIVED' ORDER BY slug",
  );
  return rows;
}

async function checkTenant(slug) {
  const cli = new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database: `tenant_${slug}`,
    user: config.TENANT_DB_SUPERUSER,
    password: config.TENANT_DB_SUPERUSER_PASSWORD,
  });
  await cli.connect();
  const out = { slug, live: null, sandbox: null };
  try {
    for (const schema of ["live", "sandbox"]) {
      await cli.query(`SET search_path = ${schema}, public`);
      const { rows } = await cli.query(FIND);
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      out[schema] = { rows, total };

      if (rows.length && FIX && schema === "live") {
        await cli.query("BEGIN");
        const res = await cli.query(
          "UPDATE depreciation_schedule SET posted = false WHERE posted = true AND entry_id IS NULL",
        );
        await cli.query("COMMIT");
        out[schema].fixed = res.rowCount;
      }
    }
  } finally {
    await cli.end();
  }
  return out;
}

(async () => {
  const platform = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
  });
  await platform.connect();

  let tenants;
  try {
    tenants = await tenantList(platform);
  } finally {
    await platform.end();
  }

  let grandTotal = 0;
  let grandRows = 0;

  for (const { slug } of tenants) {
    let r;
    try {
      r = await checkTenant(slug);
    } catch (err) {
      console.log(`\n[${slug}] SKIPPED — ${err.message}`);
      continue;
    }

    for (const schema of ["live", "sandbox"]) {
      const s = r[schema];
      if (!s || !s.rows.length) continue;
      if (schema === "live") {
        grandTotal += s.total;
        grandRows += s.rows.length;
      }
      console.log(`\n[${slug} · ${schema}] ${s.rows.length} period(s) marked posted with NO journal entry`);
      for (const row of s.rows) {
        console.log(
          `   ${row.period_code}  ${String(row.amount).padStart(14)}  ${row.label}` +
            `${row.tag ? " (" + row.tag + ")" : ""}${row.asset_status === "DISPOSED" ? "  [DISPOSED]" : ""}`,
        );
      }
      console.log(`   ${"".padStart(11)}  ${String(s.total.toFixed(2)).padStart(14)}  TOTAL not in the GL`);
      if (s.fixed !== undefined) console.log(`   cleared posted flag on ${s.fixed} row(s)`);
    }
  }

  console.log("\n" + "─".repeat(72));
  if (grandRows === 0) {
    console.log("No phantom depreciation found. Register and GL agree on this measure.");
    process.exit(0);
  }

  console.log(`${grandRows} live period(s) across all tenants, ${grandTotal.toFixed(2)} of depreciation`);
  console.log("that the fixed-asset register reports and the trial balance does not contain.");
  console.log("");
  console.log("Net book value is UNDERSTATED by that amount, and any asset disposed");
  console.log("during this window computed its gain/loss from the wrong figure —");
  console.log("check `dispose` events against these assets.");
  if (!FIX) {
    console.log("");
    console.log("Re-run with --fix to clear the false posted flags so the register tells");
    console.log("the truth. It creates no journal entries: re-posting a corrected period");
    console.log("is an accounting decision (period locks, prior-period adjustment) and");
    console.log("belongs to whoever signs the accounts.");
  }
  process.exit(1);
})().catch((err) => {
  console.error("reconcile-depreciation failed:", err.message);
  process.exit(2);
});
