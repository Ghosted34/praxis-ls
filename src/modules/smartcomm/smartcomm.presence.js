/**
 * Presence in Redis, per user (calls audit B3, C9, D6, D8, E12; PR-5 step 4).
 *
 * One sorted set per user and env, `presence:<slug>:<env>:<uid>`: a member
 * per connected socket, scored with the time that socket stops counting
 * (now + 90 s). The replica holding the socket refreshes it every 30 s, and
 * the key itself expires 90 s after the last refresh. So:
 *   - a user is online while any socket on any replica is live;
 *   - a replica that crashes stops refreshing, and its sockets stop counting
 *     within 90 s (the old tenant-wide SET kept them forever: B3);
 *   - nothing grows without bound (D8): every key carries a TTL.
 *
 * `presence:off:…` records when a user's last socket left, for the call
 * liveness check. `presence:flush:…` caps the `last_seen_at` write at one per
 * user per 5 minutes (C9). `presence:call:…` names the user's live call, so a
 * disconnect can queue that call's liveness check without a database read.
 *
 * Every function takes the Redis client and throws on a Redis error; callers
 * decide which way a failure falls.
 */
"use strict";

const PRESENCE = Object.freeze({
  ttlMs: 90_000,
  heartbeatMs: 30_000,
  lastSeenFlushS: 300,
  contactsCacheS: 300,
  offlineMemoryS: 3600,
  activeCallS: 1900,
});

const keyOf = {
  sockets: (slug, env, uid) => `presence:${slug}:${env}:${uid}`,
  offline: (slug, env, uid) => `presence:off:${slug}:${env}:${uid}`,
  flush: (slug, env, uid) => `presence:flush:${slug}:${env}:${uid}`,
  contacts: (slug, env, uid) => `presence:contacts:${slug}:${env}:${uid}`,
  call: (slug, env, uid) => `presence:call:${slug}:${env}:${uid}`,
};

/**
 * A socket connects. Returns how many live sockets the user had BEFORE this
 * one: 0 means the user has just come online.
 */
async function join(redis, { slug, env, userId, socketId, now = Date.now() }) {
  const key = keyOf.sockets(slug, env, userId);
  const res = await redis.multi()
    .zremrangebyscore(key, "-inf", now)
    .zcount(key, now, "+inf")
    .zadd(key, now + PRESENCE.ttlMs, socketId)
    .pexpire(key, PRESENCE.ttlMs)
    .del(keyOf.offline(slug, env, userId))
    .exec();
  return Number(res[1][1]) || 0;
}

/** The replica's 30 s refresh for one socket. */
async function beat(redis, { slug, env, userId, socketId, now = Date.now() }) {
  const key = keyOf.sockets(slug, env, userId);
  await redis.multi()
    .zadd(key, now + PRESENCE.ttlMs, socketId)
    .pexpire(key, PRESENCE.ttlMs)
    .exec();
}

/**
 * A socket disconnects. Returns how many live sockets the user still has; at
 * 0 the user has gone offline and the time is recorded for liveness.
 */
async function leave(redis, { slug, env, userId, socketId, now = Date.now() }) {
  const key = keyOf.sockets(slug, env, userId);
  const res = await redis.multi()
    .zrem(key, socketId)
    .zremrangebyscore(key, "-inf", now)
    .zcard(key)
    .exec();
  const left = Number(res[2][1]) || 0;
  if (left === 0) {
    await redis.set(keyOf.offline(slug, env, userId), String(now), "EX", PRESENCE.offlineMemoryS, "NX");
  }
  return left;
}

/** `{ uid: true|false }` for each user. */
async function onlineMap(redis, { slug, env, userIds, now = Date.now() }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const p = redis.pipeline();
  for (const uid of ids) p.zcount(keyOf.sockets(slug, env, uid), now, "+inf");
  const res = await p.exec();
  const out = {};
  ids.forEach((uid, i) => { out[uid] = Number(res[i][1]) > 0; });
  return out;
}

/**
 * For each user: null while online, else the time (ms) they were last seen
 * leaving. A user with no record (their replica died without a disconnect)
 * is recorded as gone from now, so the liveness window starts at the first
 * check that notices, never earlier.
 */
async function offlineSince(redis, { slug, env, userIds, now = Date.now() }) {
  const online = await onlineMap(redis, { slug, env, userIds, now });
  const out = {};
  for (const uid of Object.keys(online)) {
    if (online[uid]) { out[uid] = null; continue; }
    const key = keyOf.offline(slug, env, uid);
    await redis.set(key, String(now), "EX", PRESENCE.offlineMemoryS, "NX");
    out[uid] = Number(await redis.get(key)) || now;
  }
  return out;
}

/** True at most once per user per 5 minutes: the `last_seen_at` write (C9). */
async function claimLastSeenFlush(redis, { slug, env, userId }) {
  const ok = await redis.set(keyOf.flush(slug, env, userId), "1", "EX", PRESENCE.lastSeenFlushS, "NX");
  return ok === "OK";
}

/** The user's DIRECT contacts, cached for 5 minutes. `load()` reads the DB. */
async function contactsFor(redis, { slug, env, userId, load }) {
  const key = keyOf.contacts(slug, env, userId);
  const hit = await redis.get(key);
  if (hit) {
    try {
      const list = JSON.parse(hit);
      if (Array.isArray(list)) return list;
    } catch {
      /* @silent:parse — a bad cache entry is re-read from the database below. */
    }
  }
  const list = await load();
  await redis.set(key, JSON.stringify(list), "EX", PRESENCE.contactsCacheS);
  return list;
}

/** Forget cached contacts (a DIRECT channel was created). */
async function dropContacts(redis, { slug, env, userIds }) {
  const ks = userIds.filter(Boolean).map((uid) => keyOf.contacts(slug, env, uid));
  if (ks.length) await redis.del(...ks);
}

async function setActiveCall(redis, { slug, env, userIds, callId }) {
  const m = redis.multi();
  for (const uid of userIds) m.set(keyOf.call(slug, env, uid), callId, "EX", PRESENCE.activeCallS);
  await m.exec();
}

async function clearActiveCall(redis, { slug, env, userIds, callId }) {
  for (const uid of userIds) {
    const key = keyOf.call(slug, env, uid);
    if ((await redis.get(key)) === callId) await redis.del(key);
  }
}

async function activeCall(redis, { slug, env, userId }) {
  return redis.get(keyOf.call(slug, env, userId));
}

module.exports = {
  PRESENCE,
  keyOf,
  join,
  beat,
  leave,
  onlineMap,
  offlineSince,
  claimLastSeenFlush,
  contactsFor,
  dropContacts,
  setActiveCall,
  clearActiveCall,
  activeCall,
};
