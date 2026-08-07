/**
 * Durable sink for the error reporter — the DB half of the Error Command Center.
 *
 * `error-reporter.js` already fingerprints, dedupes and rate-limits every 5xx,
 * worker crash and browser exception. What it did NOT do is remember any of it:
 * dedupe state lives in a process Map that dies on deploy, and the transport is
 * a webhook, which is a notification rather than a record. This module is the
 * record. It is called from `report()` and writes one row per error GROUP.
 *
 * THE DEDUPE/PERSIST SPLIT — the important design point
 *
 *   The reporter suppresses a repeat fingerprint for 5 minutes so the alert
 *   channel does not get muted (OBS-A1). Persistence must NOT inherit that
 *   suppression, or `occurrence_count` — the number the whole feed is sorted
 *   and escalated on — would undercount by whatever fired inside the window,
 *   which for a hot loop is essentially all of it. So `persist()` is invoked on
 *   EVERY report, before the dedupe gate, and the counter is incremented in SQL.
 *   Notification is deduped; counting is not. Conflating the two is the single
 *   easiest way to get this feature quietly wrong.
 *
 * NEVER BLOCKS, NEVER THROWS
 *
 *   Same contract as the reporter it hangs off. A write failure is logged and
 *   swallowed; it must not turn a handled 500 into an unhandled one, and it
 *   must not add DB latency to the response path. Writes are queued and flushed
 *   on a timer, so a burst costs one round trip rather than one per error.
 *
 * COALESCING
 *
 *   Within a flush window the same signature is folded into a single UPSERT
 *   carrying its own count. 40k occurrences of one error in a 2s window become
 *   one statement with `occurrence_count = occurrence_count + 40000`, not 40k
 *   statements. Without this the sink becomes the outage during an outage.
 */

"use strict";

const { logger } = require("../../config/logger");
const { parseStack } = require("./stack-parse");

/** How long writes accumulate before a flush. */
const FLUSH_MS = 2000;
/** Ceiling on distinct signatures held in the buffer between flushes. */
const MAX_BUFFERED = 200;

/** signature -> pending row */
const buffer = new Map();
let timer = null;
let flushing = false;
/** Set by realtime wiring; called with each persisted row. Optional. */
let onPersist = null;

/** Injection seam so tests and the worker can supply their own query fn. */
let queryFn = null;
function db() {
  if (!queryFn) {
    // Required lazily: the platform pool must not be constructed at import time,
    // because this module is pulled in by the error path of every process,
    // including ones that never touch the platform DB.
     
    queryFn = require("../../services/platform/db").query;
  }
  return queryFn;
}

/** Map the reporter's severity + origin onto the spec's five levels (§2.2). */
function levelOf(payload) {
  if (payload.severity === "fatal") return "fatal";
  if (payload.severity === "warning") return "warning";
  return "error";
}

/**
 * Queue an error group for persistence.
 * @param {object} payload the reporter's assembled payload
 * @param {string} payload.fingerprint stable signature
 */
function persist(payload) {
  try {
    if (!payload || !payload.fingerprint) return;

    const sig = payload.fingerprint;
    const existing = buffer.get(sig);
    if (existing) {
      existing.count += 1;
      existing.last_seen = payload.ts || new Date().toISOString();
      return;
    }

    // Buffer full: flush early rather than grow without bound or drop.
    if (buffer.size >= MAX_BUFFERED) schedule(0);

    const { frames, primary } = parseStack(payload.stack);

    buffer.set(sig, {
      count: 1,
      signature: sig,
      tenant_slug: payload.tenant || null,
      level: levelOf(payload),
      origin: payload.origin || "server",
      message: String(payload.message || "unknown").slice(0, 2000),
      name: payload.name || "Error",
      frames,
      raw_stack: payload.stack ? String(payload.stack).slice(0, 20000) : null,
      module: (primary && primary.module) || null,
      route: payload.route || null,
      file_path: (primary && primary.file) || null,
      line_number: (primary && primary.line) || null,
      release: payload.release || null,
      env: payload.env || null,
      context: {
        request_id: payload.request_id || null,
        user_id: payload.user_id || null,
        ...(payload.extra || {}),
      },
      last_seen: payload.ts || new Date().toISOString(),
    });

    schedule(FLUSH_MS);
  } catch (err) {
    try {
      logger.warn({ err }, "error-store: failed to queue error for persistence");
    } catch {
      /* nothing left to do */
    }
  }
}

function schedule(ms) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush().catch(() => {});
  }, ms);
  // Do not hold the process open just to flush telemetry.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * UPSERT one buffered group.
 *
 * The conflict target matches migration 0080's expression index
 * (COALESCE(tenant_id, zero-uuid), signature) — a plain (tenant_id, signature)
 * unique constraint could not work, because NULL <> NULL means every
 * platform-wide error would insert a fresh row.
 *
 * On conflict the row is REOPENED if it had been resolved: an error marked
 * fixed that fires again is not fixed, and leaving it resolved would hide a
 * regression from the exact dashboard built to surface it.
 */
const UPSERT = `
INSERT INTO platform.error_event
  (tenant_id, signature, level, origin, message, name, stack_trace, raw_stack,
   module, route, file_path, line_number, release, env, context,
   first_seen, last_seen, occurrence_count)
VALUES
  ((SELECT tenant_id FROM platform.tenant WHERE slug = $1),
   $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
   $16, $16, $17)
ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), signature)
DO UPDATE SET
  occurrence_count = platform.error_event.occurrence_count + EXCLUDED.occurrence_count,
  last_seen        = GREATEST(platform.error_event.last_seen, EXCLUDED.last_seen),
  -- Escalate the stored level if this burst was worse than what we had.
  level            = CASE WHEN EXCLUDED.level = 'fatal' THEN 'fatal' ELSE platform.error_event.level END,
  message          = EXCLUDED.message,
  stack_trace      = EXCLUDED.stack_trace,
  raw_stack        = EXCLUDED.raw_stack,
  route            = COALESCE(EXCLUDED.route, platform.error_event.route),
  release          = COALESCE(EXCLUDED.release, platform.error_event.release),
  context          = EXCLUDED.context,
  resolved_at      = NULL,
  resolved_by      = NULL
RETURNING error_id, signature, tenant_id, level, origin, message, module, route,
          file_path, line_number, occurrence_count, first_seen, last_seen,
          (xmax = 0) AS is_new`;

async function flush() {
  if (flushing || buffer.size === 0) return;
  flushing = true;

  const batch = [...buffer.values()];
  buffer.clear();

  try {
    const query = db();
    for (const r of batch) {
      try {
        const { rows } = await query(UPSERT, [
          r.tenant_slug,
          r.signature,
          r.level,
          r.origin,
          r.message,
          r.name,
          JSON.stringify(r.frames),
          r.raw_stack,
          r.module,
          r.route,
          r.file_path,
          r.line_number,
          r.release,
          r.env,
          JSON.stringify(r.context),
          r.last_seen,
          r.count,
        ]);
        if (rows[0] && typeof onPersist === "function") {
          try {
            onPersist(rows[0]);
          } catch {
            /* a realtime listener must not break persistence */
          }
        }
      } catch (err) {
        // One bad row must not discard the rest of the batch.
        logger.warn({ err, signature: r.signature }, "error-store: upsert failed");
      }
    }
  } finally {
    flushing = false;
    // Anything that arrived mid-flush needs its own window.
    if (buffer.size > 0) schedule(FLUSH_MS);
  }
}

/** Register the realtime broadcaster. Called once, from the realtime layer. */
function setListener(fn) {
  onPersist = fn;
}

/** Test seam. */
function __setQuery(fn) {
  queryFn = fn;
}
function __reset() {
  buffer.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = false;
  onPersist = null;
}

module.exports = { persist, flush, setListener, __setQuery, __reset, FLUSH_MS };
