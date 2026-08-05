/**
 * The one place that opens a transaction on a tenant connection.
 *
 * Audit DATA 5.2 (Critical) and 5.1 (Critical). Neither the shared CRUD kit nor
 * the inventory balance path wrapped its statements, and no controller wrapped
 * them either (verified: zero `transaction(` calls in any *.controller.js). So
 * a business row could commit while its audit entry did not, and a stock
 * balance could move with no movement record.
 *
 * WHY A SHARED HELPER RATHER THAN BEGIN/COMMIT AT EACH SITE
 *
 * Postgres has no nested transactions. A second BEGIN inside an open
 * transaction is a warning and a no-op — and then the inner COMMIT commits the
 * OUTER transaction early, which is far worse than the bug being fixed: the
 * caller believes it still holds a transaction it can roll back, and it does
 * not.
 *
 * Detecting that reliably needs one owner of the boundary. Every path that
 * opens a transaction goes through here, so the depth counter is always
 * accurate. A nested call runs inline and lets the outermost caller decide the
 * outcome, which is the semantics callers actually expect.
 *
 * SAVEPOINTs would allow genuine partial rollback, and are the right upgrade if
 * a caller ever needs "this sub-step may fail without losing the rest". Nothing
 * needs that today, and a savepoint per nested call costs a round-trip each, so
 * this stays a depth counter until there is a reason.
 */

"use strict";

/** Symbol rather than a string key: pooled clients are long-lived and shared. */
const DEPTH = Symbol.for("praxis.tx.depth");

/**
 * Run `fn` atomically on `client`.
 *
 * Nested calls join the outer transaction: no BEGIN, no COMMIT, and a throw
 * propagates so the outermost handler rolls everything back.
 *
 * @param {{query: Function}} client
 * @param {() => Promise<any>} fn
 */
/**
 * Is this connection already inside a transaction someone ELSE opened?
 *
 * The depth counter only knows about transactions opened through here. There
 * are 76 raw `client.query("BEGIN")` sites in src/, and if one of those calls a
 * function that uses this helper, a naive `BEGIN` would be a no-op warning and
 * the subsequent COMMIT would commit the OUTER transaction early — the caller
 * would then believe it still holds a transaction it can roll back, which is
 * worse than the bug being fixed.
 *
 * `SAVEPOINT` is only legal inside a transaction block: outside one Postgres
 * raises 25P01. So attempting one is a reliable, one-round-trip probe. The
 * savepoint is released immediately and changes nothing.
 *
 * Costs one round-trip on write paths that were already doing several. Worth it
 * to make the helper safe to call from anywhere, which is the property that
 * lets the raw-BEGIN sites be converted gradually rather than in one risky
 * sweep.
 */
async function inForeignTransaction(client) {
  try {
    await client.query("SAVEPOINT praxis_tx_probe");
    await client.query("RELEASE SAVEPOINT praxis_tx_probe");
    return true;
  } catch {
    // 25P01 "SAVEPOINT can only be used in transaction blocks" — not in one.
    return false;
  }
}

async function atomically(client, fn) {
  const depth = client[DEPTH] || 0;

  // Someone else's BEGIN is still a transaction we must not commit.
  if (depth === 0 && (await inForeignTransaction(client))) {
    client[DEPTH] = 1;
    try {
      return await fn();
    } finally {
      client[DEPTH] = 0;
    }
  }

  if (depth > 0) {
    client[DEPTH] = depth + 1;
    try {
      return await fn();
    } finally {
      client[DEPTH] = depth;
    }
  }

  await client.query("BEGIN");
  client[DEPTH] = 1;
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    // A failed ROLLBACK must never mask the error that caused it.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone; the original error is the useful one */
    }
    throw err;
  } finally {
    // Always clear. A pooled client is reused by the next request, and a stale
    // depth would make that request silently skip its own BEGIN.
    client[DEPTH] = 0;
  }
}

/** True when `client` is inside a transaction opened through this helper. */
function inTransaction(client) {
  return (client && client[DEPTH] > 0) || false;
}

module.exports = { atomically, inTransaction, DEPTH };
