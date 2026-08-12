/**
 * WS-B2 — object/system backup, and WS-B4 — snapshot integrity scan.
 *
 * `backup.service.js` protects Postgres. This protects everything Postgres only
 * POINTS AT: vault documents, branding, generated media. Threat 4 in §3.2 is
 * exactly this — "a vault document is deleted or corrupted independently of
 * Postgres" — and a database backup does not cover it, because the rows survive
 * perfectly while the bytes they reference are gone.
 *
 * WHY NOT `rclone`, WHICH THE PLAN NAMES
 *
 *   §3.2 proposes `rclone sync`, and for a very large store it would be faster —
 *   it parallelises and resumes. This is an in-process sync instead, for three
 *   reasons that matter more at the current scale:
 *
 *     - no new external binary to install, version-pin and keep present in every
 *       container the worker runs in;
 *     - it works identically whether the primary is the local driver or S3,
 *       whereas an rclone invocation needs a different remote spec per driver;
 *     - it is testable without a filesystem or a bucket, which is what let the
 *       "deleting from primary must not delete offsite" property below be
 *       asserted rather than assumed.
 *
 *   The trade is honest: this is a serial list-and-copy, O(objects). If the
 *   store outgrows it, swap the body of `syncObjects` for an rclone exec — the
 *   `backup_run` bookkeeping around it does not change.
 *
 * THE PROPERTY THAT MAKES THIS A BACKUP RATHER THAN A MIRROR
 *
 *   It NEVER deletes from the destination. A mirror propagates the deletion that
 *   you are trying to recover from — which makes it worse than useless in the
 *   one scenario it exists for. Retention on the offsite copy is a separate,
 *   time-based decision (`pruneRetention`), never "the source no longer has it".
 */
"use strict";

const crypto = require("crypto");
// INCIDENT 2026-08-12 — this service is BACKGROUND work, so it draws from the
// ops pool, not the pool that serves requests. Sharing one pool let the fleet
// sweeps exhaust the connections tenant logins needed for credential
// resolution, and every tenant login timed out. A sweep may be slow; it may
// not make a user request slow. See services/platform/db.js.
const _db = require("./db");
// Resolved per call, and tolerant of a double that stubs only `query`: the
// unit tests replace this whole module, and which POOL a query used is not
// what they are asserting — the SQL is. Production always exports both.
const platformDb = { query: (t, p) => (_db.opsQuery || _db.query)(t, p) };
const backupStore = require("./backup-storage.service");
const storage = require("../storage.service");
const registry = require("../tenant/registry.service");
const backup = require("./backup.service");
const { logger } = require("../../config/logger");

/** Offsite key for a primary storage key. Namespaced so it cannot collide with dumps. */
const objectKey = (storagePath) => `objects/${storagePath}`;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * Every object this deployment is responsible for, drawn from the DATABASE
 * rather than from a bucket listing.
 *
 * Enumerating from `document_vault` is deliberate and is not just an
 * optimisation. A bucket listing tells you what storage happens to contain; the
 * table tells you what the application BELIEVES it has. The difference between
 * those two sets is the entire finding of an integrity scan — an object present
 * in storage but not the table is orphaned, and one present in the table but not
 * storage is the dangerous case, a document the app will offer to a user and
 * fail to produce. Listing the bucket can only ever find the first kind.
 */
async function tenantObjects(meta) {
  return registry.withTenantConnection(meta, "live", async (client) => {
    const { rows } = await client.query(
      `SELECT doc_id, storage_path, content_hash, created_at
         FROM document_vault
        WHERE storage_path IS NOT NULL AND storage_path <> ''
        ORDER BY created_at`,
    );
    return rows;
  });
}

/**
 * Copy one tenant's objects to the offsite store, skipping ones already there.
 *
 * `skipExisting` makes the sync incremental without keeping any state of its
 * own: the destination IS the state. A re-run after a partial failure resumes
 * rather than re-uploading everything.
 */
async function syncTenantObjects(meta, opts = {}) {
  const runId = await backup.startRun({
    tenantId: meta.tenant_id,
    slug: meta.slug,
    kind: "OBJECT_SYNC",
  });
  const started = Date.now();
  let copied = 0;
  let skipped = 0;
  let bytes = 0;
  const missing = [];

  try {
    const objects = await tenantObjects(meta);

    for (const row of objects) {
      const dest = objectKey(row.storage_path);
      if (!opts.force && (await backupStore.exists(dest))) {
        skipped++;
        continue;
      }
      let buf;
      try {
        buf = await storage.get(row.storage_path);
      } catch (err) {
        // The row says this document exists and storage disagrees. That is a
        // finding, not a reason to abandon the sync — the remaining objects are
        // still worth copying, and this one is reported.
        missing.push({ doc_id: row.doc_id, storage_path: row.storage_path, error: err.message });
        continue;
      }
      const { Readable } = require("stream");
      await backupStore.putStream(Readable.from([buf]), dest);
      copied++;
      bytes += buf.length;
    }

    await backup.finishRun(runId, {
      status: "OK",
      bytes,
      // The driver is resolved per call now (it is configurable from the
      // console), so this asks rather than reading a constant captured at import.
      location: `${await backupStore.currentDriver()}:objects/`,
    });

    const result = {
      ok: true,
      slug: meta.slug,
      copied,
      skipped,
      bytes,
      missing,
      duration_ms: Date.now() - started,
    };
    if (missing.length) {
      logger.error(
        { slug: meta.slug, missing: missing.length },
        "object sync completed with objects referenced by the database but absent from storage",
      );
    } else {
      logger.info(result, "object sync complete");
    }
    return result;
  } catch (err) {
    await backup.finishRun(runId, { status: "FAILED", error: err.message }).catch(() => {});
    logger.error({ err, slug: meta.slug }, "object sync failed");
    return { ok: false, slug: meta.slug, error: err.message, copied, skipped, missing };
  }
}

/** Sync every LIVE tenant's objects. Continue-on-failure, like the DB backup. */
async function syncFleetObjects(opts = {}) {
  const tenants = opts.tenants || (await registry.listActiveTenants());
  const results = [];
  for (const meta of tenants) results.push(await syncTenantObjects(meta, opts));

  const failed = results.filter((r) => !r.ok);
  const summary = {
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.length,
    failed_slugs: failed.map((r) => r.slug),
    copied: results.reduce((n, r) => n + (r.copied || 0), 0),
    missing: results.reduce((n, r) => n + (r.missing ? r.missing.length : 0), 0),
    results,
  };
  logger[failed.length ? "error" : "info"](
    { ...summary, results: undefined },
    "fleet object sync finished",
  );
  return summary;
}

/**
 * WS-B4 — reconcile what the database claims against what storage holds.
 *
 * Three distinct findings, and conflating them would hide the worst one:
 *
 *   MISSING   — the row exists, the object does not. The application will offer
 *               this document and fail. Worst case, and invisible until someone
 *               clicks it.
 *   CORRUPT   — the object exists but its bytes no longer hash to the recorded
 *               `content_hash`. Silent corruption; a restore would faithfully
 *               reproduce the damage.
 *   UNHASHED  — no `content_hash` was ever recorded, so nothing can be checked.
 *               Not damage, but not verifiable either, and worth surfacing
 *               because it is the blind spot in this whole scan.
 *
 * Runs BEFORE a restore needs it, which is the entire point — discovering a
 * corrupt artifact during a recovery is discovering it too late.
 */
async function scanTenantIntegrity(meta, opts = {}) {
  const runId = await backup.startRun({
    tenantId: meta.tenant_id,
    slug: meta.slug,
    kind: "SNAPSHOT_SCAN",
  });
  const started = Date.now();
  const findings = { missing: [], corrupt: [], unhashed: [] };
  let checked = 0;

  try {
    const objects = await tenantObjects(meta);
    const sample = opts.limit ? objects.slice(0, opts.limit) : objects;

    for (const row of sample) {
      let buf;
      try {
        buf = await storage.get(row.storage_path);
      } catch {
        findings.missing.push({ doc_id: row.doc_id, storage_path: row.storage_path });
        continue;
      }
      checked++;
      if (!row.content_hash) {
        findings.unhashed.push({ doc_id: row.doc_id, storage_path: row.storage_path });
        continue;
      }
      if (sha256(buf) !== row.content_hash) {
        findings.corrupt.push({
          doc_id: row.doc_id,
          storage_path: row.storage_path,
          expected: row.content_hash,
          actual: sha256(buf),
        });
      }
    }

    const bad = findings.missing.length + findings.corrupt.length;
    // Recorded as FAILED when anything is missing or corrupt: this row is what
    // an alert watches, and a scan that "succeeded" while finding corruption
    // would be reporting on itself rather than on the data.
    await backup.finishRun(runId, {
      status: bad === 0 ? "OK" : "FAILED",
      bytes: null,
      location: `scan:${meta.slug}`,
      error: bad ? `${findings.missing.length} missing, ${findings.corrupt.length} corrupt` : null,
    });

    const result = {
      ok: bad === 0,
      slug: meta.slug,
      total: sample.length,
      checked,
      missing: findings.missing.length,
      corrupt: findings.corrupt.length,
      unhashed: findings.unhashed.length,
      findings,
      duration_ms: Date.now() - started,
    };
    logger[bad ? "error" : "info"](
      { ...result, findings: undefined },
      bad ? "integrity scan found damaged objects" : "integrity scan clean",
    );
    return result;
  } catch (err) {
    await backup.finishRun(runId, { status: "FAILED", error: err.message }).catch(() => {});
    logger.error({ err, slug: meta.slug }, "integrity scan failed");
    return { ok: false, slug: meta.slug, error: err.message, findings };
  }
}

async function scanFleetIntegrity(opts = {}) {
  const tenants = opts.tenants || (await registry.listActiveTenants());
  const results = [];
  for (const meta of tenants) results.push(await scanTenantIntegrity(meta, opts));
  return {
    total: results.length,
    clean: results.filter((r) => r.ok).length,
    missing: results.reduce((n, r) => n + (r.missing || 0), 0),
    corrupt: results.reduce((n, r) => n + (r.corrupt || 0), 0),
    results,
  };
}

/** Latest OBJECT_SYNC / SNAPSHOT_SCAN per tenant, for the console. */
async function objectBackupStatus() {
  const { rows } = await platformDb.query(
    `SELECT t.slug,
            s.started_at AS last_sync_at, s.status AS last_sync_status,
            c.started_at AS last_scan_at, c.status AS last_scan_status, c.error AS last_scan_error
       FROM platform.tenant t
       LEFT JOIN LATERAL (
         SELECT started_at, status FROM platform.backup_run
          WHERE tenant_id=t.tenant_id AND kind='OBJECT_SYNC'
          ORDER BY started_at DESC LIMIT 1
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT started_at, status, error FROM platform.backup_run
          WHERE tenant_id=t.tenant_id AND kind='SNAPSHOT_SCAN'
          ORDER BY started_at DESC LIMIT 1
       ) c ON true
      WHERE t.status='LIVE'
      ORDER BY t.slug`,
  );
  return rows;
}

module.exports = {
  syncTenantObjects,
  syncFleetObjects,
  scanTenantIntegrity,
  scanFleetIntegrity,
  objectBackupStatus,
  tenantObjects,
  objectKey,
};
