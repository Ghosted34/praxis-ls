/**
 * WS-B3 — restore rehearsal. The part that makes a backup real.
 *
 * §3.2 states the problem exactly: backups are "neither scheduled centrally nor
 * ever rehearsed today, which means it is not yet a backup." WS-B1 fixed the
 * first half. This fixes the second, and it is the more important half — a dump
 * file is a claim about recoverability, and an unrehearsed claim is worth
 * roughly nothing. The failure modes that matter (a dump that restores but is
 * empty, a dump truncated by a crash, a `pg_restore` version mismatch, a schema
 * that restores without its sequences) are all invisible until someone tries.
 *
 * This is a SCRIPTED, SCHEDULED DRILL rather than a document: restore into a
 * throwaway database, run integrity probes against the restored copy, record
 * the measured RTO to `platform.restore_drill`, drop the scratch database.
 *
 * WHY IT RESTORES INTO A SCRATCH DATABASE AND NEVER OVER THE ORIGINAL
 *
 *   A drill that could touch the live tenant database is a drill nobody will
 *   schedule, and correctly so. The scratch database is named with
 *   RESTORE_DRILL_DB_PREFIX and dropped in a `finally`; the restore path
 *   REFUSES to target anything not carrying that prefix unless the caller is a
 *   real recovery explicitly asking for it (`allowNonDrillTarget`).
 *
 * WHAT THE PROBES ACTUALLY CHECK
 *
 *   Not "did pg_restore exit 0" — that is nearly worthless, since it exits 0 on
 *   an empty dump. The probes compare the restored copy against the LIVE source:
 *   table counts, row counts on core tables within tolerance, and a
 *   trial-balance recompute (debits = credits) on the ledger, which is a
 *   property that must hold in any correct copy of the data and fails loudly on
 *   a partial restore.
 */
"use strict";

const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fsSync = require("fs");
const fsp = require("fs/promises");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const { Client } = require("pg");
const platformDb = require("./db");
const store = require("./backup-storage.service");
const registry = require("../tenant/registry.service");
const m = require("./migrator");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/** Tables whose row counts are compared source-vs-restored. */
const CORE_TABLES = [
  "app_user",
  "client_master",
  "journal_entry",
  "journal_line",
  "chart_of_accounts",
  "document_vault",
];

const superuserClient = (database) =>
  new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database,
    user: config.TENANT_DB_SUPERUSER,
    password: config.TENANT_DB_SUPERUSER_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });

/** The most recent OK dump for a tenant, or the newest at/before `at`. */
async function latestBackup(slug, at = null) {
  const { rows } = await platformDb.query(
    `SELECT backup_run_id, location, checksum, bytes, started_at
       FROM platform.backup_run
      WHERE slug=$1 AND kind='PG_DUMP' AND status='OK'
        AND ($2::timestamptz IS NULL OR started_at <= $2)
      ORDER BY started_at DESC
      LIMIT 1`,
    [slug, at],
  );
  return rows[0] || null;
}

/** `local:pg/acme/x.dump` and `s3://bucket/pg/acme/x.dump` both yield the key. */
function keyFromLocation(location) {
  const s = String(location || "");
  if (s.startsWith("local:")) return s.slice("local:".length);
  const s3 = /^s3:\/\/[^/]+\/(.+)$/.exec(s);
  if (s3) return s3[1];
  return s;
}

/**
 * Restore a dump FILE into the scratch database.
 *
 * WHY A FILE AND NOT A PIPE, which is what this did first
 *
 *   A custom-format archive carries a table of contents with byte offsets, and
 *   pg_restore SEEKS through it — selecting objects, reordering, deferring
 *   constraints. stdin is not seekable. Fed through a pipe, pg_restore read the
 *   header, exited 0, printed nothing to stderr, and restored no tables: a
 *   silent, successful-looking no-op that took two rounds of instrumentation to
 *   distinguish from a corrupt dump.
 *
 *   Materialising to a temp file costs disk equal to the dump, which is trivial
 *   next to the full database copy the drill is already creating, and it is how
 *   pg_restore is designed to be used.
 */
async function runPgRestore(dumpPath, targetDb) {
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    // A restore into a fresh database still hits ordering errors that are not
    // fatal (extensions, comments on objects owned elsewhere). --exit-on-error
    // is deliberately NOT set; the probes decide whether the restore was good,
    // because pg_restore's own exit code is too blunt in both directions.
    `--host=${config.TENANT_DB_HOST_DEFAULT}`,
    `--port=${config.TENANT_DB_PORT_DEFAULT}`,
    `--username=${config.TENANT_DB_SUPERUSER}`,
    `--dbname=${targetDb}`,
    dumpPath,
  ];

  const child = spawn(config.PG_RESTORE_BIN, args, {
    env: { ...process.env, PGPASSWORD: config.TENANT_DB_SUPERUSER_PASSWORD },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });

  const exited = new Promise((resolve, reject) => {
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        return reject(
          new Error(
            `pg_restore not found (tried "${config.PG_RESTORE_BIN}"). Set PG_RESTORE_BIN to the full path — ` +
              `on Windows typically C:\\Program Files\\PostgreSQL\\<version>\\bin\\pg_restore.exe`,
          ),
        );
      }
      reject(err);
    });
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });

  // No stdin to manage, no EPIPE to handle, nothing to count: pg_restore opens
  // the file itself and can seek in it.
  return exited;
}

/**
 * Materialise a stored dump to a local temp file so pg_restore can seek in it,
 * run the restore, and always clean the temp file up.
 */
async function withLocalDump(key, fn) {
  const tmp = path.join(
    os.tmpdir(),
    `praxis-restore-${crypto.randomBytes(8).toString("hex")}.dump`,
  );
  try {
    const src = await store.openStream(key);
    let written = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        written += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(src, counter, fsSync.createWriteStream(tmp));
    const st = await fsp.stat(tmp);
    return await fn(tmp, { bytes_staged: st.size, bytes_read: written });
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

/**
 * Drop leftover drill databases.
 *
 * A crashed or killed drill leaves its scratch database behind — the `finally`
 * that drops it cannot run if the process died. Those accumulate silently and
 * each one is a full copy of a tenant, so this is disk that disappears without
 * an obvious cause. Only ever touches names carrying RESTORE_DRILL_DB_PREFIX.
 */
async function cleanupDrillDatabases({ olderThanMinutes = 0 } = {}) {
  const prefix = config.RESTORE_DRILL_DB_PREFIX;
  const admin = superuserClient("postgres");
  await admin.connect();
  const dropped = [];
  try {
    const { rows } = await admin.query(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname",
      [`${prefix}%`],
    );
    for (const r of rows) {
      // The name carries the epoch milliseconds it was created with, so an
      // age filter needs no extra bookkeeping.
      if (olderThanMinutes > 0) {
        const ts = Number(/_(\d+)$/.exec(r.datname)?.[1]);
        if (ts && Date.now() - ts < olderThanMinutes * 60_000) continue;
      }
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);
        dropped.push(r.datname);
      } catch (err) {
        logger.warn({ err, db: r.datname }, "could not drop leftover drill database");
      }
    }
  } finally {
    await admin.end().catch(() => {});
  }
  if (dropped.length) logger.info({ dropped }, "cleaned up leftover drill databases");
  return dropped;
}

/** Row counts for the core tables in one schema, missing tables reported as null. */
async function tableCounts(cli, schema) {
  const out = {};
  for (const t of CORE_TABLES) {
    try {
      const { rows } = await cli.query(`SELECT count(*)::bigint AS n FROM "${schema}"."${t}"`);
      out[t] = Number(rows[0].n);
    } catch {
      out[t] = null; // table absent — a finding, not a crash
    }
  }
  return out;
}

/**
 * Debits must equal credits. This is the probe that catches a restore which
 * "worked" but landed a partial ledger: row counts can drift legitimately
 * between the dump and the comparison, but a half-restored ledger breaks an
 * invariant that no correct copy of the data can break.
 */
async function trialBalance(cli, schema) {
  try {
    const { rows } = await cli.query(
      `SELECT COALESCE(sum(debit),0)::numeric AS d, COALESCE(sum(credit),0)::numeric AS c
         FROM "${schema}".journal_line`,
    );
    const d = Number(rows[0].d);
    const c = Number(rows[0].c);
    return { debits: d, credits: c, balanced: Math.abs(d - c) < 0.01 };
  } catch (err) {
    return { error: err.message, balanced: null };
  }
}

/**
 * Restore a tenant's backup into a database and verify it.
 *
 * `into` defaults to a drill-prefixed scratch database that is dropped
 * afterwards. Passing a non-drill target requires `allowNonDrillTarget` — a real
 * recovery is a deliberate act, not something reachable by a default.
 */
async function restoreTenant({
  slug,
  at = null,
  into = null,
  drop = true,
  allowNonDrillTarget = false,
  recordDrill = true,
} = {}) {
  if (!m.slugOk(slug)) throw new Error("invalid slug");

  const prefix = config.RESTORE_DRILL_DB_PREFIX;
  const target = into || `${prefix}${slug}_${Date.now()}`;
  if (!target.startsWith(prefix) && !allowNonDrillTarget) {
    throw new Error(
      `refusing to restore into "${target}": not a drill database (prefix "${prefix}"). ` +
        "Pass allowNonDrillTarget for a real recovery.",
    );
  }

  const started = Date.now();
  const checks = {};
  let ok = false;
  let error = null;
  let backup = null;

  try {
    backup = await latestBackup(slug, at);
    if (!backup) throw new Error(`no successful PG_DUMP recorded for "${slug}"`);
    checks.backup = {
      location: backup.location,
      taken_at: backup.started_at,
      bytes: Number(backup.bytes),
    };

    // Source counts BEFORE the restore, so the comparison is against the live
    // tenant as it is now. Drift between the dump and now is expected and is
    // why the row-count probe uses a tolerance rather than equality.
    const metas = await registry.listActiveTenants();
    const meta = metas.find((t) => t.slug === slug);
    let sourceCounts = null;
    if (meta) {
      const src = superuserClient(meta.db_name);
      await src.connect();
      try {
        sourceCounts = await tableCounts(src, meta.live_schema || "live");
      } finally {
        await src.end();
      }
    }

    // Confirm the artefact is actually there, and is the size the registry
    // recorded, BEFORE spending a restore proving it by absence. A backup_run
    // row is a claim about a file; this is the cheapest possible check that the
    // claim is still true, and it distinguishes "the dump is gone" from "the
    // dump is bad" — which the restore itself cannot.
    const key = keyFromLocation(backup.location);

    // Ask the STORE how big the artefact is. This is the check that separates
    // "the stored dump is short" from "pg_restore stopped reading early" —
    // two failures with identical downstream symptoms, and conflating them
    // sent an earlier version of this drill chasing a truncation that was not
    // there.
    const stored = await store.stat(key);
    if (!stored) {
      throw new Error(
        `backup artefact missing from storage: "${key}" (recorded at ${backup.location}). ` +
          "The backup_run row says it exists; the store disagrees.",
      );
    }
    checks.artefact = { key, bytes_on_disk: stored.bytes, bytes_recorded: Number(backup.bytes) };
    if (backup.bytes && Number(stored.bytes) !== Number(backup.bytes)) {
      throw new Error(
        `stored dump is ${stored.bytes} bytes but backup_run recorded ${backup.bytes} — the artefact is truncated`,
      );
    }

    // Tooling check, placed HERE deliberately: after the cheap argument and
    // artefact checks, before anything is created or copied.
    //
    // A wrong or missing pg_restore fails in a way that looks like bad backup
    // DATA — a fast, silent, empty restore — so catching it by name first stops
    // the drill reporting a data problem that does not exist. But it shells out,
    // so it comes after the pure-logic guards that cost nothing.
    const pre = await require("./backup.service").preflight();
    if (!pre.ok) throw new Error(`restore tooling unusable: ${pre.error}`);

    await m.ensureDatabase(target);

    const restored = await withLocalDump(key, async (dumpPath, staged) => {
      checks.staging = staged;
      if (staged.bytes_staged !== Number(backup.bytes)) {
        throw new Error(
          `staged ${staged.bytes_staged} of ${backup.bytes} bytes to ${dumpPath} — read from the store was short`,
        );
      }
      return runPgRestore(dumpPath, target);
    });

    checks.pg_restore = {
      exit_code: restored.code,
      stderr_tail: restored.stderr.slice(-500) || null,
    };

    const cli = superuserClient(target);
    await cli.connect();
    try {
      const { rows: schemas } = await cli.query(
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('live','sandbox')",
      );
      checks.schemas_present = schemas.map((r) => r.nspname);

      const { rows: tabs } = await cli.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='live'",
      );
      checks.live_table_count = tabs[0].n;

      const restoredCounts = await tableCounts(cli, "live");
      checks.row_counts = { source: sourceCounts, restored: restoredCounts };

      // 5% tolerance: the source keeps taking writes after the dump was taken,
      // so equality would fail every drill on a busy tenant. A restore that lost
      // a table or landed empty is nowhere near 5%.
      checks.row_counts_ok = !sourceCounts
        ? null
        : CORE_TABLES.every((t) => {
            const s = sourceCounts[t];
            const r = restoredCounts[t];
            if (s === null && r === null) return true; // absent in both
            if (s === null || r === null) return false; // present in one only
            if (s === 0) return r === 0;
            return Math.abs(s - r) / s <= 0.05;
          });

      checks.trial_balance = await trialBalance(cli, "live");

      ok =
        checks.live_table_count > 0 &&
        checks.schemas_present.includes("live") &&
        checks.row_counts_ok !== false &&
        checks.trial_balance.balanced !== false;

      // A restore that produced no tables is a failed restore, and pg_restore's
      // stderr is the only thing that says WHY. Surfacing it as the error means
      // the drill result is self-explanatory instead of sending someone to the
      // logs of a job that ran a month ago.
      if (!ok && checks.live_table_count === 0) {
        error =
          `pg_restore produced no tables in "live" (exit ${restored.code})` +
          (restored.stderr ? `: ${restored.stderr.slice(-800)}` : " and wrote nothing to stderr");
      }
    } finally {
      await cli.end();
    }
  } catch (err) {
    error = err.message;
    logger.error({ err, slug, target }, "restore drill failed");
  } finally {
    if (drop) {
      // Only ever drop a drill-prefixed database, however this was called.
      if (target.startsWith(prefix)) {
        const admin = superuserClient("postgres");
        try {
          await admin.connect();
          await admin.query(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
        } catch (err) {
          logger.warn({ err, target }, "could not drop drill database — clean up manually");
        } finally {
          await admin.end().catch(() => {});
        }
      } else {
        logger.warn({ target }, "not dropping a non-drill database");
      }
    }
  }

  const rtoSeconds = Math.round((Date.now() - started) / 1000);
  const withinTarget = rtoSeconds <= Number(config.RESTORE_RTO_TARGET_SECONDS);

  const result = {
    ok,
    slug,
    target,
    rto_seconds: rtoSeconds,
    rto_target_seconds: Number(config.RESTORE_RTO_TARGET_SECONDS),
    within_rto_target: withinTarget,
    checks,
    error,
  };

  if (recordDrill) {
    const { rows } = await platformDb.query(
      // $1 is cast explicitly in BOTH positions. Without the casts Postgres
      // deduces it twice — once from `restore_drill.slug` (text) and once from
      // `platform.tenant.slug` (citext) — and rejects the statement with
      // "inconsistent types deduced for parameter $1". A single placeholder
      // used against two column types must say which one it is.
      `INSERT INTO platform.restore_drill
         (tenant_id, slug, backup_run_id, restored_to, rto_seconds, ok, checks_json, error)
       SELECT t.tenant_id, $1::text, $2::uuid, $3::timestamptz, $4::int, $5::boolean, $6::jsonb, $7::text
         FROM platform.tenant t WHERE t.slug = $1::text
       RETURNING restore_drill_id`,
      [
        slug,
        backup ? backup.backup_run_id : null,
        backup ? backup.started_at : null,
        rtoSeconds,
        ok,
        JSON.stringify({ ...checks, within_rto_target: withinTarget }),
        error,
      ],
    );
    result.restore_drill_id = rows[0] ? rows[0].restore_drill_id : null;
  }

  logger.info(
    { slug, ok, rto_seconds: rtoSeconds, within_rto_target: withinTarget },
    ok ? "restore drill passed" : "restore drill FAILED",
  );
  return result;
}

/**
 * Pick the tenant due for this month's drill and run it.
 *
 * Rotating by least-recently-drilled means every tenant gets exercised over
 * time without drilling the whole fleet nightly, and a tenant that has NEVER
 * been drilled sorts first — the one most likely to be unrecoverable.
 */
async function runScheduledDrill() {
  // Sweep leftovers from any previously killed drill before adding another
  // scratch database. Each one is a full copy of a tenant, so unattended
  // accumulation is disk vanishing for no visible reason. Older than an hour,
  // so a drill running concurrently is never touched.
  await cleanupDrillDatabases({ olderThanMinutes: 60 }).catch((err) =>
    logger.warn({ err }, "drill cleanup sweep failed"),
  );

  const { rows } = await platformDb.query(
    `SELECT t.slug, max(d.ran_at) AS last_drill
       FROM platform.tenant t
       LEFT JOIN platform.restore_drill d ON d.tenant_id = t.tenant_id
      WHERE t.status='LIVE'
      GROUP BY t.slug
      ORDER BY last_drill ASC NULLS FIRST
      LIMIT 1`,
  );
  if (!rows[0]) {
    logger.info("restore drill skipped — no live tenants");
    return null;
  }
  return restoreTenant({ slug: rows[0].slug });
}

/**
 * Drill history, newest first, plus per-tenant coverage.
 *
 * `drills` is the log; `coverage` is the question D4 actually cares about —
 * which LIVE tenants have never been drilled, and how long since the last one
 * for those that have. A tenant that has never appeared in a drill is the one
 * whose backups are least trustworthy, so it sorts first and is counted
 * separately rather than being one unremarkable row among many.
 */
async function recentDrills({ limit = 50 } = {}) {
  const { rows: drills } = await platformDb.query(
    `SELECT restore_drill_id, tenant_id, slug, backup_run_id, restored_to,
            rto_seconds, ok, checks_json, error, ran_at
       FROM platform.restore_drill
      ORDER BY ran_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 50, 500)],
  );

  const { rows: coverage } = await platformDb.query(
    `SELECT t.slug,
            max(d.ran_at)                              AS last_drill_at,
            max(d.ran_at) FILTER (WHERE d.ok)          AS last_ok_drill_at,
            count(d.restore_drill_id)::int             AS drill_count
       FROM platform.tenant t
       LEFT JOIN platform.restore_drill d ON d.tenant_id = t.tenant_id
      WHERE t.status='LIVE'
      GROUP BY t.slug
      ORDER BY max(d.ran_at) ASC NULLS FIRST`,
  );

  const rtoTarget = Number(config.RESTORE_RTO_TARGET_SECONDS || 3600);
  return {
    drills,
    coverage,
    never_drilled: coverage.filter((c) => !c.last_drill_at).map((c) => c.slug),
    rto_target_seconds: rtoTarget,
  };
}

module.exports = {
  restoreTenant,
  runScheduledDrill,
  recentDrills,
  cleanupDrillDatabases,
  latestBackup,
  keyFromLocation,
  CORE_TABLES,
};
