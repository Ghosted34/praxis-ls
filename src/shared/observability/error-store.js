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

/**
 * How long writes accumulate before a flush — for a signature ALREADY in the
 * buffer. See LEADING_MS for why a first sighting does not wait this long.
 */
const FLUSH_MS = 2000;
/**
 * Leading-edge window for a signature we have not seen in this batch.
 *
 * SPEC §10 SAYS "< 500ms from backend log to UI render", AND THE 2s WINDOW
 * ABOVE MISSED IT ON EVERY ERROR.
 *
 * The broadcast to the console happens in `flush()` — `onPersist` is only
 * called after the UPSERT returns — so realtime latency was 0–2000ms with a ~1s
 * average. Nothing was slow; it was waiting, and nobody had reconciled the
 * waiting with the number in the spec.
 *
 * THE INSIGHT THAT MAKES BOTH ACHIEVABLE. The 2s window exists to survive a hot
 * loop: thousands of occurrences of the SAME error collapsing into one
 * statement. But a signature nobody has seen before is, by definition, not a hot
 * loop — it is a first sighting, which is exactly the thing that needs to reach
 * a screen quickly. Repeats can wait; they are already rendered and only their
 * count is moving.
 *
 * So: a NEW signature flushes on the leading edge, an existing one keeps the
 * long window. The 250ms floor caps flushes at four per second, so a storm of
 * thousands of DISTINCT errors still batches rather than issuing one statement
 * each — that case is now better than it was, not worse.
 *
 * Budget: 250ms + one UPSERT round trip, comfortably inside 500ms.
 */
const LEADING_MS = 250;
/** Ceiling on distinct signatures held in the buffer between flushes. */
const MAX_BUFFERED = 200;

/** signature -> pending row */
const buffer = new Map();
let timer = null;
/** When the current timer is due, so a leading-edge request can pull it in. */
let timerDueAt = 0;
let lastFlushAt = 0;
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

/**
 * Map the reporter's severity onto the spec's five levels (§2.2).
 *
 * This used to be three branches — fatal, warning, else error — so `notice` and
 * `info` COULD NOT BE PRODUCED. Nothing failed: the column accepted them, the
 * schema's CHECK listed them, §9.1 defined colour tokens for them, and the
 * filter bar rendered chips for all five. Two of those chips were dead controls
 * that returned an empty feed forever, which reads as "no notices today" rather
 * than "this level does not exist".
 *
 * Passing the severity through when it is already one of the five costs nothing
 * and lets a caller record a non-error event. Anything unrecognised still lands
 * on `error`, which is the safe direction: an unknown severity is more useful
 * over-reported than silently dropped into `info` where nobody looks.
 */
const LEVELS = ["fatal", "error", "warning", "notice", "info"];

function levelOf(payload) {
  const severity = String((payload && payload.severity) || "").toLowerCase();
  return LEVELS.includes(severity) ? severity : "error";
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
      // A repeat is already on screen; only its count is moving. It rides the
      // long window, which is what keeps a hot loop to one statement.
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

    // FIRST SIGHTING — leading edge, so spec §10's 500ms is met. See LEADING_MS.
    // The floor is measured from the last flush, not from now, so a burst of
    // distinct signatures is still batched at four flushes a second.
    const sinceFlush = Date.now() - lastFlushAt;
    schedule(sinceFlush >= LEADING_MS ? 0 : LEADING_MS - sinceFlush);
  } catch (err) {
    try {
      logger.warn({ err }, "error-store: failed to queue error for persistence");
    } catch {
      /* nothing left to do */
    }
  }
}

/**
 * Arm the flush timer.
 *
 * A pending timer is REPLACED when the new request is sooner. Without that,
 * `if (timer) return` would let a repeat that armed the 2s window swallow the
 * leading-edge request of a genuinely new error arriving 10ms later — the new
 * error would then sit unrendered for the rest of that window, which is the
 * exact latency this change exists to remove.
 */
function schedule(ms) {
  const dueAt = Date.now() + ms;
  if (timer) {
    if (dueAt >= timerDueAt) return;
    clearTimeout(timer);
  }
  timerDueAt = dueAt;
  timer = setTimeout(() => {
    timer = null;
    timerDueAt = 0;
    flush().catch(() => {});
  }, ms);
  // Do not hold the process open just to flush telemetry.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * UPSERT one buffered group.
 *
 * The conflict target matches migration 0090's expression index
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

  // Cancel the pending wake-up: this call is doing the work it was scheduled
  // for, and leaving it armed means the process holds a timer whose only job is
  // to flush an empty buffer.
  //
  // It is unref'd, so it never blocked an exit — but it DID fire after Jest tore
  // the environment down, and `db()` lazily `require()`s the platform pool on
  // first use, which produced:
  //
  //   ReferenceError: You are trying to `import` a file after the Jest
  //   environment has been torn down.  at db (error-store.js:65)
  //
  // — reported as "a worker process has failed to exit gracefully". Clearing it
  // here removes the window rather than asking every test that reports an error
  // to know this timer exists.
  if (timer) {
    clearTimeout(timer);
    timer = null;
    timerDueAt = 0;
  }
  // The leading-edge floor is measured from here, so back-to-back distinct
  // errors cannot each buy their own immediate flush.
  lastFlushAt = Date.now();

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
  timerDueAt = 0;
  // Reset to 0, not Date.now(): a test that persists immediately after a reset
  // must take the leading edge, exactly as a freshly booted process does.
  lastFlushAt = 0;
  flushing = false;
  onPersist = null;
}

module.exports = { persist, flush, setListener, __setQuery, __reset, FLUSH_MS, LEADING_MS };
