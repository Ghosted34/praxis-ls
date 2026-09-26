/**
 * The TURN shared secret: where it lives, and how it is rotated without
 * dropping a call.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * The secret has two readers that must agree. The API signs each call's
 * credential with it (`<expiry>:<call token>`, HMAC-SHA1); coturn verifies
 * that signature with its own copy. A value only one of them can see puts the
 * two out of step and every credential is refused — the relay answers 401 and
 * no call connects, while everything else looks configured.
 *
 * That is why the secret lived only in `.env`: one file both programs could
 * be pointed at. The cost is that rotating it — the one thing you actually do
 * to a shared secret — needs an SSH session, a container recreate and an API
 * restart, so in practice it never happens.
 *
 * ── HOW BOTH READERS SEE ONE VALUE ─────────────────────────────────────────
 *
 * coturn can read its secrets from Redis. `turn/realm/<realm>/secret` is a
 * SET, and every member is a valid secret — coturn accepts a credential
 * signed with any of them (`turndb/testredisdbsetup.sh`, and README.turnserver:
 * "Multiple shared secrets can be used"). That set is the mechanism this file
 * is built on, and it is what makes rotation safe:
 *
 *   1. mint a new secret and write BOTH into the set;
 *   2. the API starts signing with the new one immediately;
 *   3. a credential minted a second before the switch still verifies, because
 *      the old secret is still in the set;
 *   4. once every call that could hold an old credential has ended (the
 *      30-minute cap plus a margin), the old secret is dropped.
 *
 * No call in progress loses its relay, and no restart is involved.
 *
 * ── OFF BY DEFAULT, AND WHY ────────────────────────────────────────────────
 *
 * `TURN_SECRET_SOURCE` is `env` unless a deployment says otherwise. In that
 * mode nothing here engages: the API signs with `TURN_CREDENTIAL_SECRET`,
 * coturn keeps its `static-auth-secret` line, and Redis is not involved. So
 * merging this changes nothing for a running deployment, and an operator
 * turns it on deliberately once coturn has been given its Redis user — which
 * is a host change this code cannot make or verify for them.
 *
 * ── THE BOUNDARY THIS MOVES, STATED PLAINLY ────────────────────────────────
 *
 * docker-compose.yml's Redis block warns that the cache's isolation is "a
 * single line of docker-compose away from not being one: publish the port,
 * add a second host, run one container with `network_mode: host`". The relay
 * IS that container. Giving it a Redis connection is exactly the move that
 * comment is about, so it is given a dedicated ACL user that can read
 * `turn/*` and nothing else — no sessions, no RBAC projections, no rate-limit
 * counters. A compromised relay learns the TURN secrets it already holds.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/** The API signs with the vault's value only when a deployment opts in. */
const usingVault = () => String(config.TURN_SECRET_SOURCE || "env").toLowerCase() === "vault";

/**
 * How long a retired secret stays valid. The cap on a call is 30 minutes and
 * a credential's TTL is the call's remaining time plus a minute, so 35 covers
 * the longest credential that can still be in a browser's hands, with slack
 * for a clock that is a little behind.
 */
const OVERLAP_MS = 35 * 60 * 1000;

/** coturn's set of valid secrets for a realm (turndb/testredisdbsetup.sh). */
const secretSetKey = (realm) => `turn/realm/${realm}/secret`;

const redis = () => require("../../config/redis").getClient();

/**
 * The stored shape, inside the vault row's ENCRYPTED half:
 *
 *   { current: "…", previous: { value: "…", until: "2026-09-25T22:00:00Z" } }
 *
 * Both secrets are in the encrypted field rather than one there and one in
 * the plain `value` — a retired secret still verifies credentials, so it is
 * exactly as sensitive as the current one until it expires.
 */
function parseStored(secret) {
  if (!secret) return { current: null, previous: null };
  try {
    const parsed = JSON.parse(secret);
    if (parsed && typeof parsed === "object" && typeof parsed.current === "string") {
      return { current: parsed.current, previous: parsed.previous || null };
    }
  } catch {
    /* @silent:parse — a row written before this shape held the bare secret. */
  }
  // A plain string is a pre-rotation row: it is the current secret.
  return { current: String(secret), previous: null };
}

const serialise = ({ current, previous }) =>
  JSON.stringify(previous ? { current, previous } : { current });

/** A retired secret that is past its overlap is no longer valid. */
function livePrevious(previous, now = Date.now()) {
  if (!previous || !previous.value || !previous.until) return null;
  return Date.parse(previous.until) > now ? previous : null;
}

async function readStored() {
  const settings = require("../../services/platform/settings.service");
  try {
    const row = await settings.resolve("network", "turn");
    return parseStored(row && row.secret);
  } catch (err) {
    logger.warn({ err }, "turn secret: vault unreadable — falling back to the host's .env");
    return { current: null, previous: null };
  }
}

/**
 * The secret the API signs with RIGHT NOW.
 *
 * `.env` is the fallback on every path, including a vault that is configured
 * but empty or unreachable: the platform database must not be able to stop
 * calls connecting. A deployment that has not opted in never reads the vault
 * at all.
 */
async function activeSecret() {
  const fromEnv = String(config.TURN_CREDENTIAL_SECRET || "");
  if (!usingVault()) return fromEnv;
  const { current } = await readStored();
  return current || fromEnv;
}

/** Every secret coturn must accept: the current one, and a live retired one. */
async function validSecrets(now = Date.now()) {
  const fromEnv = String(config.TURN_CREDENTIAL_SECRET || "");
  if (!usingVault()) return fromEnv ? [fromEnv] : [];
  const { current, previous } = await readStored();
  const live = livePrevious(previous, now);
  const out = [current || fromEnv, live && live.value].filter(Boolean);
  return [...new Set(out)];
}

/**
 * Make coturn's set match `secrets` exactly, for `realm`.
 *
 * Removals matter as much as additions: a retired secret left in the set
 * verifies credentials forever, which is the whole thing rotation exists to
 * end. Computed as a difference rather than DEL-then-SADD because deleting
 * the key, however briefly, is a window in which coturn refuses every call.
 */
async function publishToRelay(secrets, realm = String(config.TURN_REALM || "")) {
  if (!realm) return { published: 0, removed: 0, reason: "no realm" };
  const key = secretSetKey(realm);
  const client = redis();
  const existing = await client.smembers(key);
  const wanted = new Set(secrets.filter(Boolean));
  const add = [...wanted].filter((s) => !existing.includes(s));
  const drop = existing.filter((s) => !wanted.has(s));
  if (add.length) await client.sadd(key, ...add);
  if (drop.length) await client.srem(key, ...drop);
  return { published: add.length, removed: drop.length, total: wanted.size };
}

/** Put coturn's set in step with the vault. Safe to call repeatedly. */
async function syncRelay() {
  if (!usingVault()) return { synced: false, reason: "secret source is env" };
  const secrets = await validSecrets();
  if (!secrets.length) return { synced: false, reason: "no secret to publish" };
  const out = await publishToRelay(secrets);
  return { synced: true, ...out };
}

/**
 * Rotate: mint a new secret, keep the old one valid for one call's length,
 * and tell coturn about both before the API starts signing with the new one.
 *
 * ORDER IS THE WHOLE THING. Redis is written FIRST: if the vault were written
 * first and the Redis write then failed, the API would immediately sign with
 * a secret coturn has never heard of and every call would fail. Written this
 * way round, a failure leaves the old secret working and the rotation simply
 * has not happened.
 */
async function rotate({ actor = null, now = Date.now() } = {}) {
  if (!usingVault()) {
    const e = new Error("rotation needs TURN_SECRET_SOURCE=vault on the host");
    e.status = 409;
    throw e;
  }
  const settings = require("../../services/platform/settings.service");
  const row = await settings.resolve("network", "turn");
  const stored = parseStored(row && row.secret);
  const current = stored.current || String(config.TURN_CREDENTIAL_SECRET || "");
  if (!current) {
    const e = new Error("there is no secret to rotate — set one first");
    e.status = 409;
    throw e;
  }

  const next = crypto.randomBytes(32).toString("hex");
  const previous = { value: current, until: new Date(now + OVERLAP_MS).toISOString() };

  // 1. coturn accepts both, before anything signs with the new one.
  await publishToRelay([next, current]);
  // 2. the API switches over.
  await settings.put({
    section: "network",
    key: "turn",
    value: (row && row.value) || {},
    secret: serialise({ current: next, previous }),
    actor,
  });
  logger.info({ until: previous.until }, "turn secret: rotated; the previous secret stays valid until then");
  return { rotated: true, previous_valid_until: previous.until };
}

/**
 * Drop a retired secret whose overlap has passed, from the vault and from
 * coturn. Idempotent, and a no-op while the window is open.
 */
async function prune({ now = Date.now() } = {}) {
  if (!usingVault()) return { pruned: false, reason: "secret source is env" };
  const settings = require("../../services/platform/settings.service");
  const row = await settings.resolve("network", "turn");
  const stored = parseStored(row && row.secret);
  if (!stored.previous) return { pruned: false, reason: "nothing retired" };
  if (livePrevious(stored.previous, now)) {
    return { pruned: false, reason: "still inside the overlap", until: stored.previous.until };
  }
  await settings.put({
    section: "network",
    key: "turn",
    value: (row && row.value) || {},
    secret: serialise({ current: stored.current, previous: null }),
  });
  await publishToRelay([stored.current]);
  logger.info("turn secret: the retired secret has expired and was dropped");
  return { pruned: true };
}

/** What the console shows: never a secret, only its shape. */
async function status() {
  const stored = usingVault() ? await readStored() : { current: null, previous: null };
  const live = livePrevious(stored.previous);
  return {
    source: usingVault() ? "vault" : "env",
    // Whether ANY secret exists to sign with, from whichever source is in force.
    secret_set: Boolean(await activeSecret()),
    rotating: Boolean(live),
    previous_valid_until: live ? live.until : null,
    // last4 is enough to tell two secrets apart without revealing either.
    last4: stored.current ? stored.current.slice(-4) : null,
  };
}

module.exports = {
  OVERLAP_MS,
  usingVault,
  secretSetKey,
  activeSecret,
  validSecrets,
  publishToRelay,
  syncRelay,
  rotate,
  prune,
  status,
  _test: { parseStored, serialise, livePrevious },
};
