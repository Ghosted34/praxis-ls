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
const platformDb = require("./db");
const store = require("./backup-storage.service");
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

module.exports = {
  preflight,
  backupTenant,
  backupFleet,
  backupStatus,
  backupKey,
  startRun,
  finishRun,
};
