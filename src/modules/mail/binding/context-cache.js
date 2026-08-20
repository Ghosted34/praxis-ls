/**
 * The 60-second per-`entity_ref` cache behind the dossier drawer (§7.5).
 *
 * ── WHY A CACHE IS PART OF THE FEATURE, NOT AN OPTIMISATION ─────────────────
 *
 * §3.6 gives `GET /mail/context` two budgets, not one: **300 ms cold and 50 ms
 * warm**. A warm figure is a statement that a second call does not re-query,
 * and there is no arrangement of SQL that meets 50 ms by being fast — it is met
 * by not going to the database. Shipping the endpoint without the cache leaves
 * half the budget unmeetable while the code looks finished, which is what
 * happened: the drawer opens on every thread click, so this is the one path
 * users feel constantly.
 *
 * ── DEGRADES, NEVER FAILS ───────────────────────────────────────────────────
 *
 * Redis being unavailable must cost latency, not the drawer. Every operation
 * here swallows its error and reports a miss, so the caller falls through to
 * the query it would have run anyway.
 *
 * ── KEYED BY CALLER AS WELL AS ENTITY ───────────────────────────────────────
 *
 * The drawer's content depends on who is asking — `last_contact_at` and the
 * interactions tab are filtered by the visibility predicate — so the user id is
 * part of the key. A cache keyed on `entity_ref` alone would serve one
 * colleague's view of a client's correspondence to another, which is the same
 * leak §9.5 closes, reintroduced one layer up.
 */
"use strict";

const { logger } = require("../../../config/logger");

const TTL_S = 60;
const PREFIX = "mailctx";

/** The events that make a cached drawer wrong (§7.5). */
const INVALIDATING_EVENTS = Object.freeze([
  "invoice.posted",
  "payment.received",
  "milestone.completed",
  "document.captured",
]);

function redis() {
  try {
    return require("../../../config/redis").getClient();
  } catch {
    return null; // not initialised (tests, workers without redis) — treat as a miss
  }
}

const keyFor = (entityRef, tab, userId) => `${PREFIX}:${entityRef}:${tab || "overview"}:${userId || "_"}`;

async function get(entityRef, tab, userId) {
  const r = redis();
  if (!r) return null;
  try {
    const raw = await r.get(keyFor(entityRef, tab, userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.debug({ err }, "[mail] context cache read skipped");
    return null;
  }
}

async function set(entityRef, tab, userId, value) {
  const r = redis();
  if (!r) return false;
  try {
    await r.set(keyFor(entityRef, tab, userId), JSON.stringify(value), "EX", TTL_S);
    return true;
  } catch (err) {
    logger.debug({ err }, "[mail] context cache write skipped");
    return false;
  }
}

/**
 * Drop every cached view of one entity, for every tab and every caller.
 *
 * SCAN rather than KEYS: this runs on an ordinary business event (an invoice
 * being posted), and KEYS blocks the whole Redis instance for the length of the
 * keyspace — on a shared instance that is every tenant's request, paused,
 * because one of them posted an invoice.
 */
async function invalidate(entityRef) {
  const r = redis();
  if (!r || !entityRef) return 0;
  const pattern = `${PREFIX}:${entityRef}:*`;
  let cursor = "0";
  let removed = 0;
  try {
    do {
       
      const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length) {
         
        await r.del(...keys);
        removed += keys.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.debug({ err, entityRef }, "[mail] context cache invalidation skipped");
  }
  return removed;
}

module.exports = { get, set, invalidate, keyFor, TTL_S, PREFIX, INVALIDATING_EVENTS };
