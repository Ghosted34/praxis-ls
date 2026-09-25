/**
 * Test calls — the run table (calls audit PR-7, O5; migration 14110).
 *
 * Every query here runs against the LIVE schema (the controller uses
 * `identityDb`, the job `withTenantConnection(…, "live")`), whatever
 * environment the run tested, so the daily cap is per tenant.
 */
"use strict";

/** Holds the cap's count-then-insert against a concurrent start. */
const CAP_LOCK_KEY = "comms_call_diagnostic_run:cap";

async function lockCap(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CAP_LOCK_KEY]);
}

/** Runs started since the start of today in `timeZone`, and when tomorrow starts. */
async function todaysRuns(client, timeZone) {
  const { rows } = await client.query(
    `WITH day AS (
       SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS start
     )
     SELECT (SELECT count(*)::int FROM comms_call_diagnostic_run r, day WHERE r.started_at >= day.start) AS used,
            (SELECT start + interval '1 day' FROM day) AS next_day`,
    [timeZone],
  );
  return { used: rows[0].used, nextDay: rows[0].next_day };
}

async function purgeOld(client, days) {
  const { rowCount } = await client.query(
    `DELETE FROM comms_call_diagnostic_run WHERE started_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return rowCount;
}

async function insertRun(client, { userId, env, steps, appVersion = null, userAgent = null }) {
  const { rows } = await client.query(
    `INSERT INTO comms_call_diagnostic_run (user_id, env, steps, app_version, user_agent)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING *`,
    [userId, env, JSON.stringify(steps), appVersion, userAgent],
  );
  return rows[0];
}

async function getRun(client, runId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_diagnostic_run WHERE run_id = $1${lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  return rows[0] || null;
}

async function listRuns(client, { limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT r.run_id, r.user_id, u.full_name AS user_name, r.env, r.started_at, r.finished_at, r.status
       FROM comms_call_diagnostic_run r
       LEFT JOIN app_user u ON u.user_id = r.user_id
      ORDER BY r.started_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

async function saveRun(client, run) {
  const { rows } = await client.query(
    `UPDATE comms_call_diagnostic_run
        SET steps = $2::jsonb, status = $3, finished_at = $4, report = $5, signal_nonce = $6
      WHERE run_id = $1
      RETURNING *`,
    [run.run_id, JSON.stringify(run.steps), run.status, run.finished_at || null, run.report || null, run.signal_nonce || null],
  );
  return rows[0] || null;
}

module.exports = { lockCap, todaysRuns, purgeOld, insertRun, getRun, listRuns, saveRun, CAP_LOCK_KEY };
