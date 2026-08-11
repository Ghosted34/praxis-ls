/**
 * Backup jobs (INFRASTRUCTURE_PLAN §3.2, WS-B1 / WS-B3).
 *
 * One queue, three behaviours, matching the shape error-maintenance and
 * health-collect already use:
 *
 *   "fleet" — pg_dump every LIVE tenant to offsite storage, one row per attempt
 *             in platform.backup_run. Nightly, BACKUP_CRON.
 *   "prune" — apply D4's retention (30 daily, 12 weekly). Runs after "fleet" so
 *             a night that failed to produce a new dump does not delete the old
 *             one it was supposed to replace.
 *   "drill" — restore the least-recently-drilled tenant into a scratch database,
 *             verify it, record the measured RTO, drop the scratch. Monthly,
 *             RESTORE_DRILL_CRON.
 *
 * WHY THE DRILL IS A JOB AND NOT A RUNBOOK STEP
 *
 *   Because a runbook step is a thing someone means to do. §3.2's whole finding
 *   is that a backup nobody has restored is not a backup, and the only way that
 *   stops being true is if the restore happens on a schedule without anyone
 *   deciding to run it. A drill that requires a human to remember it inherits
 *   exactly the failure mode it exists to remove.
 *
 * THIS HANDLER THROWS ON FAILURE, DELIBERATELY — unlike health-collect, which
 * never throws because a failed probe IS its data. Here a failed backup or a
 * failed drill is a terminal failure that must reach the error reporter and the
 * alert channel: workers.js wraps every handler with duration, request-id and
 * terminal-failure reporting, and this is precisely the job class that should
 * page someone. A silent backup failure is the exact condition that turns a
 * recoverable incident into an unrecoverable one.
 */
"use strict";

const { logger } = require("../../config/logger");
const backup = require("../../services/platform/backup.service");
const restore = require("../../services/platform/restore.service");
const store = require("../../services/platform/backup-storage.service");
const objects = require("../../services/platform/object-backup.service");

module.exports = async function backupRun(job) {
  const kind = job.name || "fleet";

  if (kind === "objects") {
    const r = await objects.syncFleetObjects();
    if (r.failed > 0) {
      throw new Error(`object sync: ${r.failed}/${r.total} tenant(s) failed — ${r.failed_slugs.join(", ")}`);
    }
    // Objects the database references but storage does not have are a data-loss
    // finding, not a job failure — the sync did its job. Surfaced loudly so it
    // reaches the alert channel without masking a genuine sync failure.
    if (r.missing > 0) {
      logger.error({ missing: r.missing }, "object sync found documents referenced by the database but absent from storage");
    }
    return { total: r.total, copied: r.copied, missing: r.missing };
  }

  if (kind === "scan") {
    const r = await objects.scanFleetIntegrity();
    if (r.missing > 0 || r.corrupt > 0) {
      throw new Error(
        `integrity scan: ${r.missing} missing, ${r.corrupt} corrupt object(s) across ${r.total} tenant(s)`,
      );
    }
    return { total: r.total, clean: r.clean };
  }

  if (kind === "prune") {
    const r = await store.pruneRetention();
    logger.info({ removed: r.removed.length, kept: r.kept }, "backup retention applied");
    return { removed: r.removed.length, kept: r.kept };
  }

  if (kind === "drill") {
    const result = await restore.runScheduledDrill();
    if (!result) return { skipped: "no live tenants" };
    if (!result.ok) {
      // Throwing puts this on the terminal-failure path, which is the point: a
      // drill that fails means the backups cannot be trusted, and that is not a
      // log line to be found later.
      throw new Error(
        `restore drill FAILED for ${result.slug}: ${result.error || "integrity probes did not pass"}`,
      );
    }
    if (!result.within_rto_target) {
      logger.warn(
        { slug: result.slug, rto_seconds: result.rto_seconds, target: result.rto_target_seconds },
        "restore drill passed but exceeded the RTO target",
      );
    }
    return { slug: result.slug, ok: true, rto_seconds: result.rto_seconds };
  }

  const summary = await backup.backupFleet();
  if (summary.failed > 0) {
    throw new Error(
      `fleet backup: ${summary.failed}/${summary.total} tenant(s) failed — ${summary.failed_slugs.join(", ")}`,
    );
  }
  return { total: summary.total, ok: summary.ok, duration_ms: summary.duration_ms };
};
