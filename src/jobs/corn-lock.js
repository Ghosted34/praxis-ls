/**
 * Distributed cron lock — Postgres advisory locks.
 *
 * node-cron fires wherever a worker process runs: with two worker instances
 * (or ENABLE_WORKERS=true on the API next to a dedicated worker), every cron
 * would run twice — double email sends, double reminders, double billing.
 * `withCronLock(name, fn)` makes each named job single-flight across ALL
 * processes sharing the database: whichever instance grabs the lock runs the
 * tick, the rest skip it silently.
 *
 * Mechanics:
 *   - A dedicated pool client takes `pg_try_advisory_lock(hashtext(key))` —
 *     non-blocking, so a losing instance skips instead of queueing.
 *   - SESSION-scoped (not transaction-scoped) so `fn` is NOT wrapped in a
 *     long-lived transaction — jobs open their own transactions freely on
 *     other pool connections. The lock client is held (idle) for the job's
 *     duration: one pool slot per concurrently-running locked job.
 *   - Crash-safe: if the process dies mid-job, the connection drops and
 *     Postgres releases the lock automatically.
 *   - If the unlock fails (broken connection), the client is destroyed
 *     rather than returned to the pool, so a stale lock can never ride a
 *     recycled connection.
 *
 * NOT for jobs that maintain per-process state (in-memory registry refresh,
 * local file downloads) — those must run on every instance; see the
 * `perInstance` option in jobs/worker.js.
 */

"use strict";

// NEW-04. This used to import `config/database`, whose `initDatabase()` IS
// NEVER CALLED ANYWHERE IN src/ — proven: `getPool()` throws
// "db pool not initialised — call initDatabase() first". So EVERY cron job
// wrapped in withCronLock threw on its first line, and because jobs swallow
// their own errors that failure was invisible. The module read as working code
// with a sensible advisory-lock design and had never once acquired a lock.
//
// `services/platform/db.js` is the pool the process actually creates, and it
// exports the same { getPool, query, close } surface.
const { getPool } = require("../services/platform/db");
const { logger } = require("../config/logger");

/**
 * Run `fn` only if this process wins the advisory lock for `name`.
 * @template T
 * @param {string} name  Stable job name, e.g. "email-campaign-send".
 * @param {() => Promise<T>} fn
 * @returns {Promise<T|undefined>} fn's result, or undefined when skipped.
 */
async function withCronLock(name, fn) {
  const key = `cron:${name}`;
  const client = await getPool().connect();
  let destroyed = false;
  try {
    const { rows } = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
      [key],
    );
    if (!rows[0].acquired) {
      logger.debug({ cron: name }, "cron lock held elsewhere — skipping tick");
      return undefined;
    }
    try {
      return await fn();
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
      } catch (unlockErr) {
        // Can't prove the unlock happened — destroy the connection so the
        // session (and its lock) dies with it instead of re-entering the pool.
        destroyed = true;
        client.release(unlockErr);
        logger.warn(
          { cron: name, err: unlockErr.message },
          "cron unlock failed — connection destroyed to drop the lock",
        );
      }
    }
  } finally {
    if (!destroyed) client.release();
  }
}

module.exports = { withCronLock };
