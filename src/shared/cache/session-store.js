/**
 * Redis-backed active-session index — the piece WORK_TO_BE_DONE.md flagged
 * as missing: "sessions are written to Postgres (user_session) on login/
 * logout; no Redis-backed active-session store, no dedicated 'kill this
 * session remotely' endpoint." Postgres (user_session) stays the source of
 * truth for everything (killed_at, killed_by are DB columns, checked by
 * app_user.service.js's refresh()); Redis is purely a fast index so "list
 * my active sessions" / a remote kill don't need extra DB round-trips.
 *
 * Best-effort like identity-cache.js: a Redis outage degrades this to
 * "index unavailable" (callers fall back to reading user_session directly
 * via session.repo.js's listForUser), never breaks login/logout/kill.
 */
"use strict";

const { getClient } = require("../../config/redis");

const SESSION_TTL_S = 60 * 60 * 24 * 30; // ceiling matches JWT_REFRESH_TTL's 30d default

const sessionKey = (sessionId) => `session:active:${sessionId}`;
const userSessionsKey = (userId) => `session:user:${userId}`;

function safeRedis() {
  try {
    return getClient();
  } catch {
    return null;
  }
}

/** Call on login, right after user_session gets its row. */
async function indexSession(sessionId, { userId, ip, userAgent, deviceLabel, environment }) {
  const redis = safeRedis();
  if (!redis) return;
  const payload = JSON.stringify({
    userId,
    ip: ip || null,
    userAgent: userAgent || null,
    deviceLabel: deviceLabel || null,
    environment: environment || "live",
    createdAt: new Date().toISOString(),
  });
  await Promise.allSettled([
    redis.set(sessionKey(sessionId), payload, "EX", SESSION_TTL_S),
    redis.sadd(userSessionsKey(userId), sessionId),
    redis.expire(userSessionsKey(userId), SESSION_TTL_S),
  ]);
}

/** Returns null (not []) when Redis is unavailable, so callers can tell
 *  "no sessions" apart from "index unreachable, go ask Postgres instead". */
async function listActiveSessionIds(userId) {
  const redis = safeRedis();
  if (!redis) return null;
  return redis.smembers(userSessionsKey(userId)).catch(() => null);
}

/**
 * Is this session still in the index? THREE-VALUED, deliberately.
 *
 *   true  — indexed, definitely live
 *   false — index reachable and this session is NOT in it
 *   null  — index unreachable; caller must not conclude anything
 *
 * SEC-M1 needs this on every authenticated request, and the distinction between
 * `false` and `null` is the whole safety of that. Redis here is a CACHE, not the
 * record: `user_session.killed_at` in Postgres is the source of truth (see the
 * header). A Redis restart, an eviction or a `FLUSHDB` empties this index while
 * every one of those sessions is still perfectly valid — so treating "not found"
 * as "revoked" would sign the entire tenant out the first time Redis blinked,
 * which is a far worse failure than the 15-minute revocation lag it is meant to
 * close. `false` therefore means "ask Postgres", not "reject".
 */
async function isSessionActive(sessionId) {
  const redis = safeRedis();
  if (!redis || !sessionId) return null;
  try {
    return (await redis.exists(sessionKey(sessionId))) === 1;
  } catch {
    return null;
  }
}

/** Call on logout and on a remote kill. */
async function removeSession(sessionId, userId) {
  const redis = safeRedis();
  if (!redis) return;
  await Promise.allSettled([
    redis.del(sessionKey(sessionId)),
    userId ? redis.srem(userSessionsKey(userId), sessionId) : Promise.resolve(),
  ]);
}

module.exports = { indexSession, listActiveSessionIds, removeSession, isSessionActive };
