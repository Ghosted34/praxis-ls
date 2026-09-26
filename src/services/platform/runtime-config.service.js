/**
 * Vault-first runtime configuration, with `.env` as the fallback.
 *
 * THE RULE THIS IMPLEMENTS
 *
 *   Anything that CAN live in the platform settings vault does. `.env` holds
 *   only two kinds of thing: a fallback for a deployment that has not been
 *   configured yet, and the settings that cannot come from the vault at all.
 *
 *   The second category is small and it is a hard constraint, not a preference:
 *   the vault lives IN the platform database, so anything needed to REACH that
 *   database (DB host, pooler host, credential cache TTL) can never be read
 *   from it. Alongside those sit Postgres's own settings (which the app does not
 *   apply), the pooler password (which must match what the container was
 *   started with, or the two silently drift), and the job schedules (read once
 *   when the worker registers its repeating jobs, so a console change would
 *   report success while nothing had changed).
 *
 * ── TWO ENTRIES, NOT FIFTEEN ───────────────────────────────────────────────
 *
 *   `storage.backup` — where backups are written, and the credentials for it.
 *                      A secret, so it uses the encrypted half of the vault.
 *   `ops.tuning`     — the numeric knobs: retention, thresholds, timeouts.
 *                      No secret; one panel instead of six.
 *
 *   Grouping them is deliberate. A setting per vault row would mean a console
 *   panel per setting and a round trip per read, and these values are read
 *   together anyway.
 *
 * ── WHY EVERY READ IS CACHED, AND WHY IT NEVER THROWS ──────────────────────
 *
 *   These are read on hot paths — every backup, every probe, every WAL segment.
 *   A platform-DB round trip per read would be a real cost, so a short TTL
 *   makes the common case free while keeping a console change effective within
 *   seconds rather than needing a restart.
 *
 *   And a vault read that fails degrades to env rather than propagating. The
 *   alternative is that a hiccup in the platform database stops backups,
 *   probes and archiving — turning a settings lookup into an outage of the
 *   machinery that exists to survive outages.
 */
"use strict";

const platformSettings = require("./settings.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/** Short enough that a console change lands without a restart. */
const TTL_MS = Number(config.RUNTIME_CONFIG_TTL_MS || 30_000);

const cache = new Map(); // "section.key" -> { at, resolved }

/**
 * Read one vault entry, or null.
 *
 * Returns `{ value, secret }` exactly as the vault stores it. A miss and a
 * failure are both null: the caller merges over env defaults either way, and
 * distinguishing them would only tempt a caller into failing closed.
 */
async function readVault(section, key) {
  const id = `${section}.${key}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.resolved;

  let resolved = null;
  try {
    resolved = await platformSettings.resolve(section, key);
  } catch (err) {
    logger.warn({ err, section, key }, "runtime config vault read failed — using env");
    resolved = null;
  }
  cache.set(id, { at: Date.now(), resolved });
  return resolved;
}

/** Drop the cache so the next read is fresh. Called after a settings write. */
function invalidate() {
  cache.clear();
}

/** First defined, non-empty value wins. `0` and `false` are values, not misses. */
const pick = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v, fallback) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  return String(v).toLowerCase() === "true";
};

/**
 * Where backups are written, and the credentials for it.
 *
 * The S3 secret key is the encrypted half; everything else is plain config. That
 * split matches how the storage, Geoapify and mail-fallback panels already work,
 * so the console renders it without a special case.
 *
 * D6 note: this bucket should be a DIFFERENT provider/account from primary
 * storage — offsite backups only protect against account compromise if they
 * live outside the account that could be compromised.
 */
async function backupStorage() {
  const row = await readVault("storage", "backup");
  const v = (row && row.value) || {};
  const secret = row && row.secret;

  return {
    driver: pick(v.driver, config.BACKUP_DRIVER, "local"),
    localPath: pick(v.local_path, config.BACKUP_LOCAL_PATH, "./data/backups"),
    s3: {
      endpoint: pick(v.endpoint, config.BACKUP_S3_ENDPOINT) || undefined,
      bucket: pick(v.bucket, config.BACKUP_S3_BUCKET) || "",
      region: pick(v.region, config.BACKUP_S3_REGION, "us-east-1"),
      accessKey: pick(v.access_key, config.BACKUP_S3_ACCESS_KEY) || "",
      // Vault secret first, then env — the whole point of the move.
      secretKey: pick(secret, config.BACKUP_S3_SECRET_KEY) || "",
      forcePathStyle: bool(v.force_path_style, config.BACKUP_S3_FORCE_PATH_STYLE),
    },
    // Which source actually answered, for the console and for diagnosing a
    // deployment that thinks it is configured and is not.
    source: row && row.value && Object.keys(row.value).length ? "vault" : "env",
  };
}

/**
 * The numeric knobs.
 *
 * All read at the point of use, which is what makes them safe to move: nothing
 * here is captured at boot, so a console change takes effect on the next
 * evaluation rather than at the next restart.
 *
 * Deliberately NOT here: the cron schedules and the collection intervals. Those
 * are read once when the worker registers its repeating jobs, so a console
 * change could not take effect until a restart — and a control that reports
 * success while changing nothing is worse than no control. `UPTIME_PROBE_
 * INTERVAL_MS` additionally IS the denominator of the availability figure, so
 * changing it silently redefines every historical percentage.
 */
async function opsTuning() {
  const row = await readVault("ops", "tuning");
  const v = (row && row.value) || {};

  return {
    backupRetainDailyDays: num(pick(v.backup_retain_daily_days, config.BACKUP_RETAIN_DAILY_DAYS), 30),
    backupRetainWeeklyWeeks: num(pick(v.backup_retain_weekly_weeks, config.BACKUP_RETAIN_WEEKLY_WEEKS), 12),
    restoreRtoTargetSeconds: num(pick(v.restore_rto_target_seconds, config.RESTORE_RTO_TARGET_SECONDS), 3600),
    healthJobFailureAmber: num(pick(v.health_job_failure_amber, config.HEALTH_JOB_FAILURE_AMBER), 5),
    healthErrorAmber: num(pick(v.health_error_amber, config.HEALTH_ERROR_AMBER), 50),
    healthLivenessSlowMs: num(pick(v.health_liveness_slow_ms, config.HEALTH_LIVENESS_SLOW_MS), 2000),
    // WS-S1 capacity headroom. 80% is the default because it leaves room to act
    // — a pool at 80% is comfortable today and worth a conversation this week,
    // which is the only band in which a capacity warning is useful. Tunable from
    // the vault because the right number depends on how spiky a deployment's
    // traffic is, and that is not knowable from here.
    healthPoolUtilisationAmber: num(
      pick(v.health_pool_utilisation_amber, config.HEALTH_POOL_UTILISATION_AMBER),
      80,
    ),
    // PgBouncer's longest current client wait, in milliseconds. 100ms is
    // deliberately low: under transaction pooling a healthy wait is sub-
    // millisecond, so a tenth of a second already means server connections are
    // the constraint. This fires well before `cl_waiting` becomes sustained.
    healthPoolerMaxwaitAmberMs: num(
      pick(v.health_pooler_maxwait_amber_ms, config.HEALTH_POOLER_MAXWAIT_AMBER_MS),
      100,
    ),
    // Smart Comms calls (guide §7.2). The sustained-transcription-failure alarm
    // is the one threshold in the programme that has no universally right
    // answer: three failures in a day is a quiet Tuesday for a fleet making a
    // thousand calls and a provider outage for a tenant making ten, and the
    // cross-over is a property of the deployment rather than of the code.
    commsTranscriptionAlertThreshold: num(
      pick(v.comms_transcription_alert_threshold, config.COMMS_TRANSCRIPTION_ALERT_THRESHOLD),
      3,
    ),
    commsTranscriptionAlertWindowHours: num(
      pick(v.comms_transcription_alert_window_hours, config.COMMS_TRANSCRIPTION_ALERT_WINDOW_HOURS),
      24,
    ),
    uptimeProbePath: pick(v.uptime_probe_path, config.UPTIME_PROBE_PATH, "/api/health/ready"),
    uptimeProbeScheme: pick(v.uptime_probe_scheme, config.UPTIME_PROBE_SCHEME, "https"),
    uptimeProbeTimeoutMs: num(pick(v.uptime_probe_timeout_ms, config.UPTIME_PROBE_TIMEOUT_MS), 10_000),
    uptimeRetainDays: num(pick(v.uptime_retain_days, config.UPTIME_RETAIN_DAYS), 90),
    walMaxLagMinutes: num(pick(v.wal_max_lag_minutes, config.WAL_MAX_LAG_MINUTES), 15),
    source: row && row.value && Object.keys(row.value).length ? "vault" : "env",
  };
}

/**
 * The call relay, as the API describes it to browsers.
 *
 * ── WHY ONLY HALF OF THE TURN SETTINGS ARE HERE ────────────────────────────
 *
 * `.env` holds thirteen TURN_* variables and this reads five of them. The
 * split is not arbitrary and it is not a migration half-done: the two halves
 * are read by two different programs.
 *
 *   THE API reads host, ports, transports and the STUN list to build the
 *   `iceServers` array a browser is handed. That array is a DESCRIPTION of
 *   the relay. A description can live in a database and change between one
 *   call and the next, because nothing is bound to it.
 *
 *   COTURN reads the realm, the listening and external IPs, the certificate
 *   paths, the port range and the quotas — from a file it renders once at
 *   start (docker/coturn/docker-entrypoint.sh). Those are BINDINGS and
 *   identity. A console cannot change what a daemon listens on, and a
 *   setting that reports success while changing nothing is worse than no
 *   setting at all (the rule at the top of this file, and the reason the job
 *   schedules are excluded too).
 *
 * TWO OF THEM ARE READ BY BOTH, and that is the trap. `TURN_PORT_UDP` and
 * `TURN_TLS_PORT` are coturn's listener AND part of the URL we advertise.
 * They stay env-only here ON PURPOSE: making them settable would let the
 * console advertise `turns:host:443` while coturn still listens on 5349 and
 * the firewall still drops 443 — a change that looks like it worked and
 * breaks every relayed call. The console shows them read-only instead, and
 * the Test button proves what the relay is actually doing.
 *
 * `TURN_CREDENTIAL_SECRET` is env-only for the same reason the pooler
 * password is: the API signs with it and coturn verifies with it, so a value
 * only one of them can see puts the two out of step and every credential is
 * refused. Moving it needs coturn reading its secret from Redis and an
 * overlapping rotation, which is its own change.
 */
async function turn() {
  const row = await readVault("network", "turn");
  const v = (row && row.value) || {};

  const host = String(pick(v.host, config.TURN_HOST, "") || "").trim();
  // The VALUE is deliberately not a field on the object below. This is a
  // description of the relay — passed around, returned to callers, shaped
  // into a console response — and the one value that must not leak has no
  // business riding along on it. Whoever signs fetches it at the point of
  // signing (smartcomm.turn.secret.service.activeSecret).
  //
  // Its PRESENCE still has to follow TURN_SECRET_SOURCE: on `vault` a
  // deployment can have no TURN_CREDENTIAL_SECRET at all and be perfectly
  // configured, so asking env alone here would report no relay and the
  // console would show a working deployment as broken.
  const secretSet = Boolean(
    await require("../../modules/smartcomm/smartcomm.turn.secret.service").activeSecret(),
  );
  return {
    // Settable from the console: the API is their only reader.
    host,
    portTcp: num(pick(v.port_tcp, config.TURN_PORT_TCP), 3478),
    transports: String(pick(v.transports, config.TURN_TRANSPORTS, "udp,tcp")),
    stunUrls: String(pick(v.stun_urls, config.STUN_URLS, "") || ""),

    // Host-owned. Read here because the API needs them to build a URL, NOT
    // settable — see the note above.
    portUdp: num(config.TURN_PORT_UDP, 3478),
    tlsPort: num(config.TURN_TLS_PORT, 0),
    secretSource: String(config.TURN_SECRET_SOURCE || "env"),

    /** A relay exists only when both halves of the credential do: somewhere
     *  to reach, and something to sign with. The secret itself stays out of
     *  this object — see above. */
    secretSet,
    configured: Boolean(host && secretSet),
    source: row && row.value && Object.keys(row.value).length ? "vault" : "env",
  };
}

/**
 * What coturn is configured with, for the console to DISPLAY. Never settable
 * from there, so it is read straight from env with no vault layer — showing a
 * vault value for something coturn cannot read would be a lie with a text box
 * next to it.
 */
function turnHostOwned() {
  return {
    realm: String(config.TURN_REALM || ""),
    external_ip: String(config.TURN_EXTERNAL_IP || ""),
    listening_ip: String(config.TURN_LISTENING_IP || ""),
    port_udp: num(config.TURN_PORT_UDP, 3478),
    tls_port: num(config.TURN_TLS_PORT, 0),
    secret_set: Boolean(config.TURN_CREDENTIAL_SECRET),
  };
}

module.exports = { backupStorage, opsTuning, turn, turnHostOwned, invalidate, readVault, TTL_MS };
