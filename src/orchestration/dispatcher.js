/**
 * Orchestration dispatcher (Plan A / A1) — the outbox consumer.
 *
 * `event_log` is the durable, append-only outbox. `dispatchPending(client)` runs
 * on a TENANT connection (via the orchestration-dispatch job) and processes
 * committed events that haven't been handled yet: for each, it invokes the
 * registered handlers, then records the outcome in `event_dispatch`.
 *
 * Delivery is at-least-once — handlers MUST be idempotent (A2). Each handler owns
 * its own transaction boundary (the module services already BEGIN/COMMIT), so the
 * dispatcher does NOT wrap them in one shared transaction (that would collide with
 * a service's inner COMMIT). A handler throw marks the event FAILED (retried up to
 * maxAttempts) then DEAD (dead-letter); other events are unaffected.
 */
"use strict";

const registry = require("./registry");
require("./handlers"); // side-effect: register all handlers
const { logger } = require("../config/logger");
const { report } = require("../shared/observability/error-reporter");

const MAX_ATTEMPTS = 5;

async function featureEnabled(client, key) {
  if (!key) return true;
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM feature_state WHERE feature_key = $1 AND state = 'on' LIMIT 1",
      [key],
    );
    return rows.length > 0;
  } catch {
    return true; // feature_state unavailable → don't block orchestration
  }
}

async function markDone(client, eventId) {
  await client.query(
    "INSERT INTO event_dispatch (event_id, status, attempts) VALUES ($1,'DONE',0) " +
      "ON CONFLICT (event_id) DO UPDATE SET status='DONE', last_error=NULL, updated_at=now()",
    [eventId],
  );
}

async function markFailed(client, eventId, attempts, maxAttempts, err) {
  const status = attempts >= maxAttempts ? "DEAD" : "FAILED";
  await client.query(
    "INSERT INTO event_dispatch (event_id, status, attempts, last_error) VALUES ($1,$2,$3,$4) " +
      "ON CONFLICT (event_id) DO UPDATE SET status=$2, attempts=$3, last_error=$4, updated_at=now()",
    [eventId, status, attempts, String((err && err.message) || err).slice(0, 500)],
  );
  return status;
}

/**
 * Dead-letter census for the caller's tenant/schema.
 *
 * OBS-A6: "Nothing ever queries event_dispatch WHERE status='DEAD'." This is
 * that query. Surfaced on /api/health/ready and swept by the worker so a
 * permanently-dropped business event is visible without anyone thinking to look.
 *
 * @returns {Promise<{total:number, byType:Array<{event_type_key:string,count:number,oldest:string,last_error:string}>}>}
 */
async function countDeadLetters(client, { limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT el.event_type_key,
            COUNT(*)::int      AS count,
            MIN(ed.updated_at) AS oldest,
            MAX(ed.last_error) AS last_error
       FROM event_dispatch ed
       JOIN event_log el ON el.event_id = ed.event_id
      WHERE ed.status = 'DEAD'
      GROUP BY el.event_type_key
      ORDER BY count DESC
      LIMIT $1`,
    [limit],
  );
  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    byType: rows.map((r) => ({
      event_type_key: r.event_type_key,
      count: r.count,
      oldest: r.oldest,
      last_error: r.last_error,
    })),
  };
}

/**
 * Process the pending event backlog for the caller's tenant/schema.
 * @returns {Promise<{scanned:number, processed:number, failed:number, dead:number, skipped:number}>}
 */
async function dispatchPending(client, { limit = 200, maxAttempts = MAX_ATTEMPTS } = {}) {
  const { rows } = await client.query(
    "SELECT el.event_id, el.event_type_key, el.entity_ref, el.payload, COALESCE(ed.attempts,0) AS attempts " +
      "FROM event_log el LEFT JOIN event_dispatch ed ON ed.event_id = el.event_id " +
      "WHERE ed.event_id IS NULL OR (ed.status = 'FAILED' AND ed.attempts < $1) " +
      "ORDER BY el.event_id ASC LIMIT $2",
    [maxAttempts, limit],
  );

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let dead = 0;

  for (const ev of rows) {
    const hs = registry.getHandlers(ev.event_type_key);
    if (!hs.length) {
      // No subscriber — mark handled so it leaves the queue (the event still
      // lives forever in event_log for audit).
       
      await markDone(client, ev.event_id);
      skipped += 1;
      continue;
    }
    try {
      for (const h of hs) {
         
        if (await featureEnabled(client, h.feature)) {
           
          await h.run(client, ev);
        }
      }
       
      await markDone(client, ev.event_id);
      processed += 1;
    } catch (err) {
      const attempts = Number(ev.attempts) + 1;
       
      const status = await markFailed(client, ev.event_id, attempts, maxAttempts, err);

      // OBS-A6 (Critical). This used to log ONE warn line, byte-identical for a
      // retriable FAILED and a terminal DEAD — so there was no way to alert on
      // "gave up permanently", and nothing anywhere queried for DEAD rows.
      //
      // The handlers that die here are the cross-module money flows
      // (costing-approved-draft-invoice, supplier-invoice-posted-cost-entry,
      // receipt-posted-collected-signal). An approved costing that should
      // generate a draft invoice simply never generated one — permanently,
      // while the app returned 200s.
      //
      // A retry that will be retried is `warn`. Giving up is `error` AND a
      // report, because at that point a business action has been silently
      // dropped and only a human can put it right.
      if (status === "DEAD") {
        logger.error(
          { err, event_id: String(ev.event_id), key: ev.event_type_key, attempts },
          "[orchestration] handler DEAD — giving up, this business event will never be processed",
        );
        report(err, {
          origin: "worker",
          severity: "fatal",
          route: `orchestration/${ev.event_type_key}`,
          extra: {
            event_id: String(ev.event_id),
            event_type_key: ev.event_type_key,
            entity_ref: ev.entity_ref,
            attempts,
            dropped: true,
          },
        });
        dead += 1;
      } else {
        logger.warn(
          { err, event_id: String(ev.event_id), key: ev.event_type_key, attempts },
          "[orchestration] handler failed — will retry",
        );
      }
      failed += 1;
    }
  }

  return { scanned: rows.length, processed, failed, dead, skipped };
}

module.exports = { dispatchPending, countDeadLetters, MAX_ATTEMPTS };
