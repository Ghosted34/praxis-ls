/**
 * AI health events — the signals the assistant already produces and threw away.
 *
 * ── WHY THIS EXISTS (audit H2) ──────────────────────────────────────────────
 *
 * "`recordUsage` logs tokens/latency/success, but truncation, tool-selection
 * misses, duplicate-read grooves, and fallback-to-stub events are not
 * first-class metrics."
 *
 * Every one of those is ALREADY DETECTED. `orchestrator.ask` counts
 * `duplicates` and stops on a groove; it sets `nudged` when the anti-stall
 * prompt fires; it breaks on `MAX_TOOL_ROUNDS`; `llm.chat` walks a vendor chain
 * and logs when it falls through. All of it lands in a log line and nowhere a
 * person can count. So the questions an operator actually asks — "is the
 * assistant degrading?", "did that fix work?" — have no answer short of
 * grepping logs across a fleet.
 *
 * THE ONE THAT MADE THIS URGENT is truncation. PR 2 (audit B1) set an explicit
 * `max_tokens` because vendor defaults were cutting answers off mid-sentence.
 * `finish_reason` was never read, before or after — so whether the NEW ceiling
 * is also being hit is unknowable, and the fix for B1 is unverifiable in
 * exactly the way B1 itself was. A truncation counter is how PR 2 stops being
 * a change we believe in and starts being one we can see.
 *
 * ── WHY NOT THE USAGE LEDGER ────────────────────────────────────────────────
 *
 * `ai_usage_ledger` answers "what did this cost", is tied to a budget period,
 * and is read by the spend cap. A turn that degraded to the fallback and came
 * back truncated still SUCCEEDED in the only sense that table means, which is
 * why the orchestrator passes `wasSuccessful: true` unconditionally and is
 * right to. Overloading a cost table with a quality signal would put the spend
 * cap downstream of a definition change. See 13940.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 *
 * `record` is BEST-EFFORT AND NEVER THROWS. Observability that can fail a turn
 * is worse than no observability: it converts a degraded answer into no answer.
 * Every caller sits on the critical path, so this swallows its own failure the
 * same way `recordUsage` does, and for the same reason.
 *
 * `KINDS` is the owned vocabulary — the column is plain `text` with no CHECK
 * precisely so that adding a signal is a change here rather than a migration
 * against a pre-existing table. `record` refuses an unknown kind rather than
 * writing it, because a typo'd kind is a metric that silently reads zero
 * forever, which is the failure mode this whole file exists to end.
 */
"use strict";

const { logger } = require("../../config/logger");

/**
 * Every signal worth counting, and what each one means when it is not zero.
 *
 * TRUNCATION          the vendor stopped on `finish_reason: "length"` — the
 *                     answer is cut off. Above ~0 means AI_MAX_TOKENS is too
 *                     low for real questions (audit B1).
 * FALLBACK            the primary vendor did not answer and a later vendor in
 *                     the chain did. The turn succeeded; the cost model and the
 *                     answer quality are both the fallback's (audit B2).
 * VENDOR_CONFIG_ERROR a 401/403/404 from a vendor — a key or endpoint is wrong.
 *                     Never transient; somebody has to go and fix it.
 * PROVIDER_EXHAUSTED  no vendor in the chain answered, so the user got the stub.
 *                     This is the "fallback-to-stub" the audit names.
 * TIMEOUT             a vendor call exceeded its budget (audit E1's caps).
 * TOOL_ROUND_CAP      the loop hit MAX_TOOL_ROUNDS still reaching for tools —
 *                     the model could not find what it needed. The audit's
 *                     "tool-selection miss".
 * GROOVE              the model re-requested reads it had already made until
 *                     MAX_DUPLICATE_READS stopped it.
 * STALL_NUDGE         the model announced an action and emitted no tool call,
 *                     so the anti-stall prompt had to fire.
 */
const KINDS = {
  TRUNCATION: "truncation",
  FALLBACK: "fallback",
  VENDOR_CONFIG_ERROR: "vendor_config_error",
  PROVIDER_EXHAUSTED: "provider_exhausted",
  TIMEOUT: "timeout",
  TOOL_ROUND_CAP: "tool_round_cap",
  GROOVE: "groove",
  STALL_NUDGE: "stall_nudge",
};

const KIND_VALUES = new Set(Object.values(KINDS));

/**
 * Record one event. Never throws, never blocks the answer.
 *
 * Returns true when a row was written, so a test can assert the call happened
 * without reaching for the database — callers ignore it.
 */
async function record(client, { userId = null, conversationId = null, feature = null, kind, provider = null, model = null, detail = null } = {}) {
  if (!KIND_VALUES.has(kind)) {
    // Loud, because the alternative is a counter that reads zero for ever and
    // is believed. Still not thrown: a bad kind is our bug, not the user's.
    logger.error({ kind }, "[ai] unknown health event kind — not recorded");
    return false;
  }
  try {
    await client.query(
      "INSERT INTO ai_health_event (user_id, conversation_id, feature_key, kind, provider, model, detail) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [userId, conversationId, feature, kind, provider, model, detail === null || detail === undefined ? null : JSON.stringify(detail)],
    );
    return true;
  } catch (err) {
    logger.warn({ err, kind }, "[ai] health event not recorded");
    return false;
  }
}

/**
 * Record a batch of events collected during one turn.
 *
 * `llm.chat` DETECTS the vendor-chain events (it is the only layer that knows
 * a fallback happened) but has no conversation, no user and no opinion about
 * persistence, so it returns them and the orchestrator — which has all three —
 * writes them here. Sequential rather than parallel: these are diagnostics on
 * the critical path and a burst of concurrent INSERTs on the request's single
 * shared connection buys nothing (see middleware/tenant-context).
 */
async function recordAll(client, events, context = {}) {
  if (!Array.isArray(events) || !events.length) return 0;
  let written = 0;
  for (const e of events) {
    // Sequential on purpose — one shared connection per request, see above.
    if (await record(client, { ...context, ...e })) written += 1;
  }
  return written;
}

/**
 * The panel's read: how often each signal fired over a window, as a RATE.
 *
 * RATES, NOT COUNTS, and that is the whole design of this query. The audit's
 * acceptance criterion is "truncation/timeout/fallback rates trending to zero
 * after PRs 1–7" — and a raw count cannot show that, because a count rises with
 * adoption. Twelve truncations is excellent on ten thousand turns and alarming
 * on twenty. The denominator is chat turns from `ai_usage_ledger` over the same
 * window, which is the closest thing the schema has to "answers given".
 *
 * `per_1k` rather than a percentage: the healthy values here are fractions of a
 * percent, and a panel that renders every row as "0.0%" has stopped reporting.
 */
async function summary(client, { days = 7 } = {}) {
  const window = Math.min(Math.max(Number(days) || 7, 1), 90);
  const { rows: turnRows } = await client.query(
    "SELECT COUNT(*)::int AS turns FROM ai_usage_ledger " +
      "WHERE call_type = 'chat' AND occurred_at >= now() - ($1 || ' days')::interval",
    [window],
  );
  const turns = (turnRows[0] && turnRows[0].turns) || 0;

  const { rows } = await client.query(
    "SELECT kind, COUNT(*)::int AS events, MAX(occurred_at) AS last_at " +
      "FROM ai_health_event WHERE occurred_at >= now() - ($1 || ' days')::interval " +
      "GROUP BY kind ORDER BY events DESC",
    [window],
  );

  const seen = new Map(rows.map((r) => [r.kind, r]));
  // EVERY kind is returned, including the ones at zero. A panel that only lists
  // what fired cannot show a rate trending to zero — the row disappears at the
  // moment it becomes good news, and the operator cannot tell "fixed" from
  // "never instrumented".
  const kinds = Object.values(KINDS).map((kind) => {
    const row = seen.get(kind);
    const events = row ? row.events : 0;
    return {
      kind,
      events,
      last_at: row ? row.last_at : null,
      per_1k: turns ? Math.round((events / turns) * 1000 * 10) / 10 : null,
    };
  });
  return { window_days: window, turns, kinds };
}

/** The most recent events, for the panel's detail list. */
async function recent(client, { limit = 50, kind = null } = {}) {
  const { rows } = await client.query(
    "SELECT health_event_id, kind, provider, model, detail, occurred_at, conversation_id " +
      "FROM ai_health_event WHERE ($2::text IS NULL OR kind = $2) " +
      "ORDER BY occurred_at DESC LIMIT $1",
    [Math.min(Math.max(Number(limit) || 50, 1), 200), kind],
  );
  return rows;
}

module.exports = { KINDS, record, recordAll, summary, recent };
