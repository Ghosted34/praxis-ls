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
}

/**
 * Process the pending event backlog for the caller's tenant/schema.
 * @returns {Promise<{scanned:number, processed:number, failed:number, skipped:number}>}
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

  for (const ev of rows) {
    const hs = registry.getHandlers(ev.event_type_key);
    if (!hs.length) {
      // No subscriber — mark handled so it leaves the queue (the event still
      // lives forever in event_log for audit).
      // eslint-disable-next-line no-await-in-loop
      await markDone(client, ev.event_id);
      skipped += 1;
      continue;
    }
    try {
      for (const h of hs) {
        // eslint-disable-next-line no-await-in-loop
        if (await featureEnabled(client, h.feature)) {
          // eslint-disable-next-line no-await-in-loop
          await h.run(client, ev);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await markDone(client, ev.event_id);
      processed += 1;
    } catch (err) {
      logger.warn(
        { err: err.message, event_id: String(ev.event_id), key: ev.event_type_key },
        "[orchestration] handler failed",
      );
      // eslint-disable-next-line no-await-in-loop
      await markFailed(client, ev.event_id, Number(ev.attempts) + 1, maxAttempts, err);
      failed += 1;
    }
  }

  return { scanned: rows.length, processed, failed, skipped };
}

module.exports = { dispatchPending, MAX_ATTEMPTS };
