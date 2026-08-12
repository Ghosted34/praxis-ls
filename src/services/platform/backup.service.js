/**
 * WS-B1 — per-tenant Postgres backup.
 *
 * Database-per-tenant is what makes this simple: a tenant's entire state is one
 * `pg_dump`, and restoring one tenant never touches another. That property is
 * the strongest argument for the tenancy model, and until now nothing was
 * exercising it — §3.2 is blunt that backups were "neither scheduled centrally
 * nor ever rehearsed today, which means it is not yet a backup."
 *
 * This module is layer 1 of the two D4 ratified: scheduled per-tenant logical
 * dumps, custom format, compressed, written offsite through the backup storage
 * driver, every attempt recorded to `platform.backup_run`. Layer 2 (cluster WAL
 * archiving for point-in-time recovery) is deployment configuration rather than
 * application code — `pgBackRest`/`wal-g` against the same bucket — and is not
 * driven from here.
 *
 * THREE DESIGN POINTS WORTH KNOWING
 *
 * 1. STREAMED, NEVER BUFFERED. `pg_dump` writes to stdout and that stream goes
 *    straight to storage. A real tenant's dump does not fit comfortably in the
 *    worker's heap, and a backup job that OOMs the worker takes out every other
 *    scheduled job with it.
 *
 * 2. THE PASSWORD NEVER APPEARS IN ARGV. `pg_dump` is spawned with PGPASSWORD in
 *    its environment, not `--dbname=postgresql://user:pass@host`. Anything in
 *    argv is world-readable in `ps` output for the life of the process, and a
 *    backup job runs for minutes.
 *
 * 3. CONTINUE ON FAILURE. One unreachable tenant must not stop the fleet's
 *    backup — that is exactly the shape of outage where the OTHER tenants'
 *    backups matter most. Failures become FAILED rows, which is what makes
 *    staleness alertable, and the run reports them without throwing.
 */
"use strict";

const { spawn } = require("child_process");
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
const store = require("./backup-storage.service");
const runtimeConfig = require("./runtime-config.service");
const registry = require("../tenant/registry.service");
const dbCredentials = require("../tenant/db-credential.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/**
 * Backup keys are date-partitioned per tenant: `pg/<slug>/<ISO-hour>.dump`.
 * Sortable, one prefix per tenant (so a single-tenant restore lists one
 * directory), and the hour granularity means a same-day re-run does not silently
 * overwrite the morning's good dump with an evening failure.
 */
function backupKey(slug, at = new Date()) {
  const iso = at.toISOString();
  return `pg/${slug}/${iso.slice(0, 13)}.dump`; // YYYY-MM-DDTHH
}

/** Open a `backup_run` row before the work starts, so a crash still leaves a trace. */
async function startRun({ tenantId, slug, kind }) {
  const { rows } = await platformDb.query(
    `INSERT INTO platform.backup_run (tenant_id, slug, kind, status, started_at)
       VALUES ($1,$2,$3,'FAILED', now())
     RETURNING backup_run_id`,
    [tenantId || null, slug || null, kind],
  );
  // Inserted as FAILED deliberately: the row is only promoted to OK once the
  // artefact is durably written. A process killed mid-dump therefore leaves a
  // FAILED row rather than nothing, and "nothing" is the state that reads as
  // "no backup was attempted" when in fact one was attempted and lost.
  return rows[0].backup_run_id;
}

async function finishRun(id, { status, bytes, location, checksum, error }) {
  await platformDb.query(
    `UPDATE platform.backup_run
        SET status=$2, bytes=$3, location=$4, checksum=$5, error=$6, finished_at=now()
      WHERE backup_run_id=$1`,
    [id, status, bytes ?? null, location || null, checksum || null, error ? String(error).slice(0, 2000) : null],
  );
}

/**
 * Spawn `pg_dump` for one tenant database and return its stdout stream plus a
 * promise that settles when the process exits.
 *
 * Custom format (`-Fc`) rather than plain SQL: it is compressed, and it is what
 * `pg_restore` needs to restore selectively (a single schema, a single table)
 * during a drill or a partial recovery.
 */
function spawnPgDump(meta, cred) {
  const args = [
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-acl",
    `--host=${meta.db_host}`,
    `--port=${meta.db_port}`,
    `--username=${cred.user}`,
    // NOT via the pooler. A transaction pooler cannot serve pg_dump's
    // consistent snapshot across many statements, and the registry keeps the
    // real host precisely so migrations and dumps can bypass PgBouncer.
    meta.db_name,
  ];

  const child = spawn(config.PG_DUMP_BIN, args, {
    env: { ...process.env, PGPASSWORD: cred.password },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    // Keep only the tail: a dump of a broken database can emit megabytes of
    // notices, and the last lines are the ones that say why it failed.
    stderr = (stderr + d.toString()).slice(-4000);
  });

  const exited = new Promise((resolve, reject) => {
    child.on("error", (err) => {
      // ENOENT here means the binary is not on PATH, which is by far the most
      // common first-run failure and reads as a bare "spawn pg_dump ENOENT"
      // that says nothing about how to fix it. On Windows the client tools are
      // rarely on PATH even when Postgres is installed and running.
      if (err.code === "ENOENT") {
        return reject(
          new Error(
            `pg_dump not found (tried "${config.PG_DUMP_BIN}"). Set PG_DUMP_BIN to the full path — ` +
              `on Windows typically C:\\Program Files\\PostgreSQL\\<version>\\bin\\pg_dump.exe`,
          ),
        );
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.trim() || "no stderr"}`));
    });
  });

  return { stdout: child.stdout, exited, child };
}

/**
 * Are the client tools present, and new enough for this server?
 *
 * `pg_dump` refuses to dump a server NEWER than itself — "server version 16.2;
 * pg_dump version 15.6" and it aborts. A client older than the server is
 * therefore not a degraded backup, it is NO backup, and the way this normally
 * gets discovered is at 01:00 in a container nobody is watching, weeks after a
 * base-image rebuild silently moved the client version.
 *
 * The reverse — a newer client against an older server — is explicitly
 * supported, so the check is one-directional.
 *
 * Cheap enough to run before every fleet backup and from the CLI.
 */
/**
 * Ask a binary what it is, and check it is the tool we think it is.
 *
 * THE IDENTITY CHECK IS NOT PEDANTRY. `PG_RESTORE_BIN` pointing at `pg_dump.exe`
 * is a one-character configuration slip that produces a catastrophically
 * misleading failure: `pg_dump --dbname=<scratch>` happily dumps the empty
 * scratch database to a discarded stdout and exits 0. The drill sees a fast,
 * silent, successful process and an empty database — which reads as "the backup
 * restores to nothing", i.e. it blames the DUMP. Chasing that costs hours and
 * ends in the wrong place.
 *
 * `--version` names the tool. Making the check assert on that name turns a
 * misleading data-loss story into one line: wrong binary.
 */
async function probeBinary(binPath, expectedName) {
  const res = await new Promise((resolve) => {
    const child = spawn(binPath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d.toString()));
    child.on("error", (err) =>
      resolve({
        error:
          err.code === "ENOENT"
            ? `${expectedName} not found (tried "${binPath}"). On Alpine/Debian install postgresql-client; on Windows set the full path.`
            : err.message,
      }),
    );
    child.on("close", () => resolve({ text: text.trim() }));
  });

  if (res.error) return { ok: false, version: null, major: null, error: res.error };

  const text = res.text || "";
  if (!text.toLowerCase().startsWith(expectedName.toLowerCase())) {
    return {
      ok: false,
      version: text,
      major: null,
      error:
        `"${binPath}" is not ${expectedName} — it identifies itself as "${text}". ` +
        `Point the ${expectedName === "pg_dump" ? "PG_DUMP_BIN" : "PG_RESTORE_BIN"} setting at the real ${expectedName} binary.`,
    };
  }

  const m = /(\d+)(?:\.\d+)?/.exec(text);
  return {
    ok: true,
    version: text,
    major: m ? Number(m[1]) : null,
    error: m ? null : `could not parse a version from "${text}"`,
  };
}

async function preflight() {
  const out = { ok: false, pg_dump: null, pg_restore: null, server: null, error: null };

  const dump = await probeBinary(config.PG_DUMP_BIN, "pg_dump");
  out.pg_dump = dump.version;
  if (!dump.ok || dump.error) {
    out.error = dump.error;
    return out;
  }

  // pg_restore is checked too. It was not, and that omission is exactly why a
  // misconfigured restore binary surfaced as a phantom backup corruption.
  const restore = await probeBinary(config.PG_RESTORE_BIN, "pg_restore");
  out.pg_restore = restore.version;
  if (!restore.ok || restore.error) {
    out.error = restore.error;
    return out;
  }

  try {
    const { rows } = await platformDb.query("SHOW server_version");
    out.server = rows[0].server_version;
    const serverMajor = Number(/(\d+)/.exec(out.server)[1]);

    const older = [
      ["pg_dump", dump.major],
      ["pg_restore", restore.major],
    ].find(([, major]) => major !== null && major < serverMajor);

    if (older) {
      out.error =
        `${older[0]} ${older[1]} is OLDER than the server (${serverMajor}) — it will refuse to run. ` +
        `Install postgresql${serverMajor}-client (or newer) in the image that runs the worker.`;
    } else {
      out.ok = true;
    }
  } catch (err) {
    out.error = `could not read server version: ${err.message}`;
  }

  return out;
}

/**
 * Back up one tenant. Returns a result object; throws only on a programming
 * error, never on a backup failure — the failure is the return value and the
 * FAILED row.
 */
async function backupTenant(meta, opts = {}) {
  const at = opts.at || new Date();
  const key = backupKey(meta.slug, at);
  const runId = await startRun({ tenantId: meta.tenant_id, slug: meta.slug, kind: "PG_DUMP" });
  const started = Date.now();

  try {
    const cred = await dbCredentials.resolveCredential(meta);
    const { stdout, exited } = spawnPgDump(meta, cred);

    // Both must succeed: the upload can finish while pg_dump is still failing
    // (a dump that errors part-way still wrote bytes), so the exit code is
    // awaited alongside rather than assumed from a completed upload. Without
    // this, a partial dump gets an OK row — the worst possible outcome, because
    // it looks like a backup until the day you need it.
    const [written] = await Promise.all([store.putStream(stdout, key), exited]);

    await finishRun(runId, {
      status: "OK",
      bytes: written.bytes,
      location: written.location,
      checksum: written.checksum,
    });

    const result = {
      ok: true,
      slug: meta.slug,
      key,
      location: written.location,
      bytes: written.bytes,
      checksum: written.checksum,
      duration_ms: Date.now() - started,
      backup_run_id: runId,
    };
    logger.info(result, "tenant backup complete");
    return result;
  } catch (err) {
    await finishRun(runId, { status: "FAILED", error: err.message }).catch(() => {});
    logger.error({ err, slug: meta.slug, key }, "tenant backup failed");
    return {
      ok: false,
      slug: meta.slug,
      key,
      error: err.message,
      duration_ms: Date.now() - started,
      backup_run_id: runId,
    };
  }
}

/**
 * Back up every LIVE tenant, one at a time.
 *
 * Sequential on purpose. Parallel dumps multiply I/O on a shared Postgres host
 * and the whole point of running at 01:00 is to be cheap; a fleet backup that
 * saturates the disk is an outage with good intentions.
 */
async function backupFleet(opts = {}) {
  // Check the tooling once, before spending an hour proving it per tenant. A
  // version-skewed client fails identically for every tenant, and N identical
  // FAILED rows say the fleet is broken when the real answer is one package.
  if (opts.preflight !== false) {
    const pre = await preflight();
    if (!pre.ok) {
      logger.error({ ...pre }, "backup preflight failed — no tenant will be dumped");
      return {
        total: 0,
        ok: 0,
        failed: 0,
        failed_slugs: [],
        preflight_error: pre.error,
        duration_ms: 0,
        results: [],
      };
    }
  }

  const tenants = opts.tenants || (await registry.listActiveTenants());
  const started = Date.now();
  const results = [];

  for (const meta of tenants) {
    results.push(await backupTenant(meta, opts));
  }

  const failed = results.filter((r) => !r.ok);
  const summary = {
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.length,
    failed_slugs: failed.map((r) => r.slug),
    duration_ms: Date.now() - started,
  };

  if (failed.length) logger.error(summary, "fleet backup finished with failures");
  else logger.info(summary, "fleet backup complete");

  return { ...summary, results };
}

/**
 * Per-tenant backup freshness, for the console and for alerting.
 *
 * The important column is `stale`: a tenant whose most recent OK dump is older
 * than the D4 RPO (24h, plus a grace window for a late-running job) has an
 * unmet recovery objective, and a tenant that has NEVER had one is worse — it
 * shows as stale with a null timestamp rather than being quietly absent from
 * the report, which is how a never-backed-up tenant stays invisible.
 */
async function backupStatus({ rpoHours = 24, graceHours = 6 } = {}) {
  const { rows } = await platformDb.query(
    `SELECT t.tenant_id, t.slug,
            b.started_at  AS last_ok_at,
            b.bytes       AS last_ok_bytes,
            b.location    AS last_ok_location,
            f.started_at  AS last_failure_at,
            f.error       AS last_error
       FROM platform.tenant t
       LEFT JOIN LATERAL (
         SELECT started_at, bytes, location FROM platform.backup_run
          WHERE tenant_id = t.tenant_id AND kind='PG_DUMP' AND status='OK'
          ORDER BY started_at DESC LIMIT 1
       ) b ON true
       LEFT JOIN LATERAL (
         SELECT started_at, error FROM platform.backup_run
          WHERE tenant_id = t.tenant_id AND kind='PG_DUMP' AND status='FAILED'
          ORDER BY started_at DESC LIMIT 1
       ) f ON true
      WHERE t.status = 'LIVE'
      ORDER BY t.slug`,
  );

  const cutoff = Date.now() - (rpoHours + graceHours) * 3_600_000;
  const tenants = rows.map((r) => ({
    ...r,
    never_backed_up: !r.last_ok_at,
    stale: !r.last_ok_at || new Date(r.last_ok_at).getTime() < cutoff,
    age_hours: r.last_ok_at
      ? Math.round((Date.now() - new Date(r.last_ok_at).getTime()) / 36_000) / 100
      : null,
  }));

  return {
    rpo_hours: rpoHours,
    tenants,
    stale_count: tenants.filter((t) => t.stale).length,
    never_count: tenants.filter((t) => t.never_backed_up).length,
  };
}

/**
 * The raw run log, newest first — what the console shows under the freshness
 * summary.
 *
 * `backupStatus` answers "is every tenant covered right now"; this answers "what
 * has the backup system actually been doing", which is the question you ask when
 * the first answer is bad. Failures are included by default and are the whole
 * point: a run log filtered to successes cannot explain a gap.
 */
async function recentRuns({ limit = 100, kind = null, slug = null, status = null } = {}) {
  const where = [];
  const params = [];
  if (kind) params.push(kind), where.push(`kind = $${params.length}`);
  if (slug) params.push(slug), where.push(`slug = $${params.length}`);
  if (status) params.push(status), where.push(`status = $${params.length}`);
  params.push(Math.min(Number(limit) || 100, 500));

  const { rows } = await platformDb.query(
    `SELECT backup_run_id, tenant_id, slug, kind, status, bytes, location, checksum,
            started_at, finished_at, duration_ms, error
       FROM platform.backup_run
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY started_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/**
 * WS-B1 layer 2 — is WAL archiving actually alive, and what RPO does it buy?
 *
 * `archive_command` deliberately does no bookkeeping: it runs on the Postgres
 * host's critical path once per segment, and a platform-DB write per segment
 * would couple WAL archiving to the availability of the thing it protects. The
 * cost of that choice is that a silently dead archiver looks exactly like a
 * quiet one — so this check is the other half, and it must run on a schedule.
 *
 * THE FAILURE THIS EXISTS TO CATCH
 *
 *   `archive_command` failing is loud in the Postgres log and nowhere else, and
 *   Postgres keeps the un-archived WAL on disk while it retries — so the first
 *   externally visible symptom of a broken archiver is the data volume filling
 *   up, days later. Meanwhile the console would still be reporting a healthy
 *   nightly dump, and the 5-minute RPO everyone believes in would have silently
 *   reverted to 24 hours.
 *
 *   So: `lag_minutes` is the number that matters, and a stale archive is
 *   recorded as a FAILED WAL run, which routes to the alert channel through the
 *   same path a failed backup does.
 */
async function walStatus() {
  const prefix = config.WAL_ARCHIVE_PREFIX || "wal";
  const maxLag = Number((await runtimeConfig.opsTuning()).walMaxLagMinutes);

  if (!config.WAL_ARCHIVE_ENABLED) {
    return {
      enabled: false,
      // Said plainly, because the whole point of D4 was to ratify a number and
      // this is the number that actually holds when WAL archiving is off.
      rpo_minutes: 24 * 60,
      note: "WAL archiving is off — recovery is limited to the nightly dump, so the real RPO is 24h, not 5 minutes.",
    };
  }

  // The two switches disagreeing is the misconfiguration worth naming, because
  // its symptom — a permanently empty archive — gives no clue which half is
  // wrong, and the obvious guess (the upload is broken) is the wrong one.
  if (config.WAL_ARCHIVE_MODE !== "on") {
    return {
      enabled: true,
      healthy: false,
      segments: 0,
      rpo_minutes: 24 * 60,
      error:
        "WAL_ARCHIVE_ENABLED is true but Postgres has archive_mode=off, so nothing is being written to " +
        "the archive. Set WAL_ARCHIVE_MODE=on and restart Postgres.",
    };
  }

  try {
    const segments = await store.list(prefix);
    if (!segments.length) {
      return {
        enabled: true,
        healthy: false,
        segments: 0,
        rpo_minutes: 24 * 60,
        error:
          "WAL archiving is on but the archive is EMPTY — Postgres has not shipped a segment yet. " +
          "Check the postgres logs for archive_command failures.",
      };
    }

    // Newest by modified time, not by name: a timeline switch makes names
    // non-monotonic, and this question is "when did we last hear from the
    // archiver", which is a clock question.
    let newest = null;
    for (const s of segments) {
      if (!s.modified) continue;
      if (!newest || new Date(s.modified) > new Date(newest)) newest = s.modified;
    }

    const lagMinutes = newest ? Math.round((Date.now() - new Date(newest).getTime()) / 60000) : null;
    const healthy = lagMinutes !== null && lagMinutes <= maxLag;

    return {
      enabled: true,
      healthy,
      segments: segments.length,
      newest_at: newest,
      lag_minutes: lagMinutes,
      max_lag_minutes: maxLag,
      // Achievable RPO: roughly the archive lag while healthy, the nightly dump
      // otherwise. Reporting 5 minutes off the back of a dead archiver is
      // exactly the false assurance this function exists to prevent.
      rpo_minutes: healthy ? Math.max(1, lagMinutes) : 24 * 60,
      error: healthy
        ? null
        : `WAL archive is ${lagMinutes}m stale (limit ${maxLag}m) — PITR cannot reach later than ${newest}.`,
    };
  } catch (err) {
    return {
      enabled: true,
      healthy: false,
      rpo_minutes: 24 * 60,
      error: `could not read the WAL archive: ${err.message}`,
    };
  }
}

/**
 * Record the WAL archive's health as a `backup_run` row.
 *
 * Written as a run rather than only returned, so "has WAL archiving been alive"
 * is answerable as history — and so a stale archive reaches the alert channel by
 * the same route a failed dump does, instead of needing its own plumbing.
 */
async function recordWalStatus() {
  const status = await walStatus();
  if (!status.enabled) return status;

  const runId = await startRun({ tenantId: null, slug: null, kind: "WAL" });
  await finishRun(runId, {
    status: status.healthy ? "OK" : "FAILED",
    bytes: null,
    location: `${await store.currentDriver()}:${config.WAL_ARCHIVE_PREFIX || "wal"}/`,
    error: status.error,
  });
  return status;
}

module.exports = {
  preflight,
  backupTenant,
  backupFleet,
  backupStatus,
  recentRuns,
  walStatus,
  recordWalStatus,
  backupKey,
  startRun,
  finishRun,
};
