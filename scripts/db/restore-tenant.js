#!/usr/bin/env node
/**
 * WS-B3 — restore rehearsal, and the real-recovery path.
 *
 *   node scripts/db/restore-tenant.js --slug=acme
 *       Restore acme's latest backup into a throwaway database, run the
 *       integrity probes, record the drill and the measured RTO, drop the
 *       scratch database. This is the drill.
 *
 *   node scripts/db/restore-tenant.js --slug=acme --at=2026-08-01T00:00:00Z
 *       Same, against the newest backup taken at or before that instant.
 *
 *   node scripts/db/restore-tenant.js --slug=acme --keep
 *       Leave the scratch database in place to inspect it.
 *
 *   node scripts/db/restore-tenant.js --slug=acme --into=tenant_acme_recovered --i-am-recovering
 *       A REAL recovery into a named database. Requires the explicit flag: the
 *       service refuses any non-drill target without it, because a restore that
 *       can overwrite a live tenant by default is a drill nobody will schedule.
 *
 *   node scripts/db/restore-tenant.js --history
 *       Past drills: outcome, measured RTO, target.
 *
 *   node scripts/db/restore-tenant.js --cleanup
 *       Drop scratch databases left behind by a killed drill. Each is a full
 *       copy of a tenant, so they are disk that disappears without a cause.
 *
 * Exit 1 when the drill fails, so the monthly run can page someone.
 */
"use strict";

const restore = require("../../src/services/platform/restore.service");
const platformDb = require("../../src/services/platform/db");
const registry = require("../../src/services/tenant/registry.service");
const { config } = require("../../src/config/env");
const runtimeConfig = require("../../src/services/platform/runtime-config.service");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const JSON_OUT = has("--json");

async function cmdHistory() {
  const { rows } = await platformDb.query(
    `SELECT slug, ran_at, ok, rto_seconds, error
       FROM platform.restore_drill
      ORDER BY ran_at DESC LIMIT 25`,
  );
  if (JSON_OUT) return console.warn(JSON.stringify(rows, null, 2));
  if (!rows.length) {
    return console.warn(
      "No restore drill has ever run. Until one does, the backups are untested.",
    );
  }
  const tuning = await runtimeConfig.opsTuning();
  console.warn(`RTO target: ${tuning.restoreRtoTargetSeconds}s (from ${tuning.source})\n`);
  console.warn("when              tenant      result   RTO");
  console.warn("-".repeat(52));
  for (const r of rows) {
    const rto = r.rto_seconds === null ? "-" : `${r.rto_seconds}s`;
    const over =
      r.rto_seconds > Number(tuning.restoreRtoTargetSeconds) ? "  <-- over target" : "";
    console.warn(
      `${new Date(r.ran_at).toISOString().slice(0, 16)}  ${String(r.slug).padEnd(10)}  ` +
        `${(r.ok ? "PASS" : "FAIL").padEnd(7)}  ${rto.padStart(6)}${over}`,
    );
  }
}

(async () => {
  try {
    if (has("--history")) {
      await cmdHistory();
      return;
    }

    if (has("--cleanup")) {
      const dropped = await restore.cleanupDrillDatabases();
      console.warn(
        dropped.length
          ? `dropped ${dropped.length} leftover drill database(s):\n  ${dropped.join("\n  ")}`
          : "no leftover drill databases.",
      );
      return;
    }

    const slug = val("slug");
    if (!slug) {
      console.warn("usage: --slug=<tenant> [--at=<iso>] [--keep] [--into=<db> --i-am-recovering] | --history");
      process.exitCode = 2;
      return;
    }

    const result = await restore.restoreTenant({
      slug,
      at: val("at") || null,
      into: val("into") || null,
      drop: !has("--keep"),
      allowNonDrillTarget: has("--i-am-recovering"),
    });

    if (JSON_OUT) {
      console.warn(JSON.stringify(result, null, 2));
    } else {
      console.warn(`\n${result.ok ? "PASS" : "FAIL"} — ${slug}`);
      console.warn(`  restored into : ${result.target}`);
      console.warn(
        `  measured RTO  : ${result.rto_seconds}s (target ${result.rto_target_seconds}s)` +
          (result.within_rto_target ? "" : "  <-- OVER TARGET"),
      );
      const c = result.checks;
      if (c.backup) {
        console.warn(
          `  backup used   : ${c.backup.location} (${(c.backup.bytes / 1048576).toFixed(1)}MB, taken ${new Date(c.backup.taken_at).toISOString().slice(0, 16)})`,
        );
      }
      if (c.artefact) {
        console.warn(
          `  artefact      : ${c.artefact.bytes_on_disk} bytes on disk / ${c.artefact.bytes_recorded} recorded`,
        );
      }
      if (c.staging) console.warn(`  staged        : ${c.staging.bytes_staged} bytes`);
      if (c.pg_restore) {
        console.warn(`  pg_restore    : exit ${c.pg_restore.exit_code}`);
        if (c.pg_restore.stderr_tail) console.warn(`  restore stderr: ${c.pg_restore.stderr_tail}`);
      }
      if (c.live_table_count !== undefined) console.warn(`  live tables   : ${c.live_table_count}`);
      if (c.row_counts_ok !== undefined) {
        console.warn(`  row counts    : ${c.row_counts_ok === null ? "no source to compare" : c.row_counts_ok ? "within tolerance" : "MISMATCH"}`);
      }
      if (c.trial_balance) {
        console.warn(
          `  trial balance : ${c.trial_balance.balanced === null ? "not checked" : c.trial_balance.balanced ? "balanced" : "OUT OF BALANCE"}`,
        );
      }
      if (result.error) console.warn(`  error         : ${result.error}`);
    }

    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.warn(`error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await registry.closeAll().catch(() => {});
    await platformDb.close().catch(() => {});
  }
})();
