/** Notification repository. Everything is scoped to the caller's user_id — a
 *  user only ever reads/marks their OWN notifications. All SQL lives here. */
"use strict";
const { page } = require("../../shared/db/query-helpers");

async function mine(client, userId, q = {}) {
  const { limit, offset } = page(q);
  const params = [userId, limit, offset]; const wh = ["user_id = $1"];
  if (q.unread === "true" || q.unread === true) wh.push("read_at IS NULL");
  if (q.channel) { params.push(q.channel); wh.push("channel = $" + params.length); }
  if (q.category) { params.push(q.category); wh.push("category = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM notification WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $2 OFFSET $3", params);
  return rows;
}
/**
 * Insert a single IN_APP notification targeted at ONE user. Used by
 * security-flow producers (e.g. password reset) that need to notify the affected
 * user directly, rather than the Watch-the-Watcher CEO/MANAGEMENT fan-out in
 * shared/events/emit.js. Runs on the caller's connection so it can join the
 * triggering transaction.
 */
async function insertForUser(client, { userId, eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL", category = null }) {
  const { rows } = await client.query(
    `INSERT INTO notification (user_id, channel, event_type_key, title, body, entity_ref, priority, category)
     VALUES ($1, 'IN_APP', $2, $3, $4, $5, $6, $7)
     RETURNING notification_id, created_at`,
    [userId, eventTypeKey, title, body, entityRef, priority === "HIGH" ? "HIGH" : "NORMAL", category],
  );
  return rows[0];
}

async function unreadCount(client, userId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return rows[0].n;
}
async function markRead(client, id, userId) {
  const { rows } = await client.query("UPDATE notification SET read_at = now() WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL RETURNING notification_id", [id, userId]);
  return rows[0] || null;
}
async function markAllRead(client, userId) {
  const { rowCount } = await client.query("UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return rowCount;
}

// ── Preferences (1.2) — a user manages their own opt-outs. Missing row = enabled. ──
async function getPreferences(client, userId) {
  const { rows } = await client.query(
    "SELECT channel, category, enabled, updated_at FROM notification_preference WHERE user_id = $1 ORDER BY channel, category",
    [userId]);
  return rows;
}
async function putPreferences(client, userId, prefs) {
  const out = [];
  for (const p of prefs) {
     
    const { rows } = await client.query(
      "INSERT INTO notification_preference (user_id, channel, category, enabled) VALUES ($1,$2,$3,$4) " +
        "ON CONFLICT (user_id, channel, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now() " +
        "RETURNING channel, category, enabled, updated_at",
      [userId, p.channel, p.category, p.enabled]);
    out.push(rows[0]);
  }
  return out;
}
// ── Recipient lookups (for producers that fan a notification to a group) ──
/** Active user_ids holding a given role (approval task assignees). */
async function roleRecipients(client, roleId) {
  if (!roleId) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
      WHERE ur.role_id = $1 AND u.status = 'ACTIVE'`,
    [roleId],
  );
  return rows.map((r) => r.user_id);
}
// action → permission column. Fixed whitelist: the column is interpolated into
// SQL below, so it must NEVER come from an untrusted/free-form source.
const PERMISSION_COLUMN = {
  view: "can_read", read: "can_read",
  create: "can_create",
  edit: "can_update", update: "can_update",
  delete: "can_delete",
  approve: "can_approve",
};
/** Active users whose roles grant `action` permission on `moduleKey` — i.e. the
 *  people entitled to that action, who should be told when it happens. */
async function recipientsWithPermission(client, moduleKey, action = "view") {
  if (!moduleKey) return [];
  const col = PERMISSION_COLUMN[action] || "can_read";
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN permission p  ON p.role_id  = ur.role_id
      WHERE u.status = 'ACTIVE' AND p.module_key = $1 AND p.${col} = true`,
    [moduleKey],
  );
  return rows.map((r) => r.user_id);
}

/** The user who first triggered an entity's event chain — used as the
 *  "requester" to notify when their item is approved/rejected. Earliest
 *  event_log actor for the entity_ref, or null. */
async function requesterFor(client, entityRef) {
  if (!entityRef) return null;
  const { rows } = await client.query(
    `SELECT actor_user_id FROM event_log
      WHERE entity_ref = $1 AND actor_user_id IS NOT NULL
      ORDER BY created_at ASC LIMIT 1`,
    [entityRef],
  );
  return rows[0] ? rows[0].actor_user_id : null;
}

// ── Web-Push subscriptions (0473) — a user's opted-in browsers/devices. ──
/**
 * Register (or refresh) one device.
 *
 * `vapidKeyHash` (12770) is the fingerprint of the public key the browser
 * subscribed with. It is what lets a later send recognise a subscription that
 * belongs to a key this deployment has since rotated away from — the failure
 * that produced a permanent, silent push outage, because push services answer
 * that case with 403 and every safety net here was watching for 404/410.
 *
 * `last_used_at` is deliberately NOT set here any more. It was, by both this
 * and the rotation below, and nothing else ever wrote it — so the one column
 * that could say "has this device ever actually received anything" only ever
 * said "when did it register". The send path writes it now; `created_at`
 * already records the registration.
 */
async function savePushSubscription(client, userId, { endpoint, p256dh, auth, userAgent, vapidKeyHash = null }) {
  const { rows } = await client.query(
    `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent, vapid_key_hash)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           vapid_key_hash = COALESCE(EXCLUDED.vapid_key_hash, push_subscription.vapid_key_hash),
           last_error = NULL, last_failed_at = NULL
     RETURNING subscription_id`,
    [userId, endpoint, p256dh, auth, userAgent || null, vapidKeyHash],
  );
  return rows[0];
}
/**
 * Store a rotation token against a subscription, by endpoint.
 *
 * Only the SHA-256 lands in the table. The plaintext is returned to the caller
 * once, handed to the browser, and kept in IndexedDB where the service worker
 * can read it without a session — see migration 12752 for why possession of a
 * token, rather than of the old endpoint, is what proves same-device.
 */
async function setRotationToken(client, endpoint, tokenHash) {
  const { rowCount } = await client.query(
    "UPDATE push_subscription SET rotation_token_hash = $2 WHERE endpoint = $1",
    [endpoint, tokenHash],
  );
  return rowCount;
}

/**
 * Move a subscription onto its new endpoint, proven by a rotation token.
 *
 * The token is the WHOLE authorisation: this runs unauthenticated, because the
 * service worker making the call has no session. So the statement is written to
 * be the entire check — it matches on the hash and nothing else, and it clears
 * the token in the same UPDATE, which makes it single-use even against two
 * concurrent callers (the second matches no row). The new token is written by
 * the caller afterwards.
 *
 * Returns the owning user_id when a row moved, or null when the token was
 * unknown, already spent, or the subscription is gone.
 */
async function rotatePushSubscription(client, { tokenHash, endpoint, p256dh, auth, vapidKeyHash = null }) {
  const { rows } = await client.query(
    `UPDATE push_subscription
        SET endpoint = $2, p256dh = $3, auth = $4,
            vapid_key_hash = COALESCE($5, vapid_key_hash),
            rotation_token_hash = NULL, last_error = NULL, last_failed_at = NULL
      WHERE rotation_token_hash = $1
      RETURNING user_id, subscription_id`,
    [tokenHash, endpoint, p256dh, auth, vapidKeyHash],
  );
  return rows[0] || null;
}

/** How many devices this user currently has registered. */
async function countPushSubscriptions(client, userId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM push_subscription WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

/**
 * One row per registered device, for the Settings panel and the self-test.
 *
 * The ENDPOINT never leaves the server. It is a capability URL: anyone holding
 * it can push to that device, which is exactly why 12752 refused to use it as
 * proof of identity. Its host is enough to tell an Android phone from a
 * desktop Firefox, and the user agent names the rest.
 */
async function listPushSubscriptions(client, userId) {
  const { rows } = await client.query(
    `SELECT endpoint, user_agent, vapid_key_hash, created_at,
            last_used_at, last_failed_at, last_error
       FROM push_subscription
      WHERE user_id = $1
      ORDER BY created_at`,
    [userId],
  );
  return rows;
}

/**
 * Claim the right to tell this user their last device went quiet, at most once
 * per COOLDOWN.
 *
 * `ON CONFLICT ... WHERE` makes the claim atomic: two workers pruning two of
 * the same user's devices in the same moment cannot both send the notice. A
 * cooldown rather than a one-time flag because a device CAN lapse again months
 * later, and that is worth saying again — just not twice in an afternoon.
 *
 * Returns true when this caller won the claim and should send.
 */
async function claimDeviceLapseNotice(client, userId, endpoint, cooldownHours = 24) {
  const { rows } = await client.query(
    `INSERT INTO push_device_lapse (user_id, notified_at, last_endpoint)
     VALUES ($1, now(), $2)
     ON CONFLICT (user_id) DO UPDATE
       SET notified_at = now(), last_endpoint = EXCLUDED.last_endpoint
     WHERE push_device_lapse.notified_at < now() - ($3 || ' hours')::interval
     RETURNING user_id`,
    [userId, endpoint || null, String(cooldownHours)],
  );
  return rows.length > 0;
}

/** A user who registers a device again is no longer lapsed. */
async function clearDeviceLapse(client, userId) {
  await client.query("DELETE FROM push_device_lapse WHERE user_id = $1", [userId]);
}

async function deletePushSubscription(client, userId, endpoint) {
  const { rowCount } = await client.query(
    "DELETE FROM push_subscription WHERE user_id = $1 AND endpoint = $2",
    [userId, endpoint],
  );
  return rowCount;
}

/**
 * Enforcement helper: is (channel, category) delivery allowed for this user?
 * When the user has set no explicit preference row, fall back to `defaultEnabled`
 * — IN_APP defaults ON (cheap, in-product), while outbound channels like EMAIL
 * default OFF so we never message someone who never opted in.
 * Any non-security notification path MUST consult this before delivering
 * (security-critical alerts are unconditional).
 */
async function isChannelEnabled(client, userId, channel, category, defaultEnabled = true) {
  const { rows } = await client.query(
    "SELECT enabled FROM notification_preference WHERE user_id = $1 AND channel = $2 AND category = $3",
    [userId, channel, category]);
  return rows[0] ? rows[0].enabled === true : defaultEnabled;
}
/**
 * PERF S5. Channel preferences for MANY users in one round-trip.
 *
 * `isChannelEnabled` above is one query per (user, channel). The fan-out called
 * it twice per recipient — IN_APP and EMAIL — so notifying 50 finance users of
 * one posted invoice issued 100 preference queries before it inserted anything.
 *
 * Absence of a row means the caller's default (the table stores explicit
 * overrides only), so this returns just the rows that exist and lets the caller
 * apply its own default. Returning a fully-populated map would require knowing
 * the default here, and the two channels disagree about it.
 */
async function preferencesFor(client, userIds, channels, category) {
  if (!userIds || userIds.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT user_id, channel, enabled
       FROM notification_preference
      WHERE user_id = ANY($1::uuid[]) AND channel = ANY($2::text[]) AND category = $3`,
    [userIds, channels, category],
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.user_id}:${r.channel}`, r.enabled === true);
  return map;
}

/**
 * PERF S5. Insert one notification per user in a single statement.
 *
 * A multi-row INSERT … SELECT unnest() rather than N inserts: same rows, one
 * round-trip, one WAL flush. `unnest` keeps it parameterised — the alternative,
 * building a VALUES list, means N placeholders and a statement whose text
 * changes with the recipient count, which defeats the plan cache.
 */
async function insertForUsers(client, userIds, { eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL", category = null }) {
  if (!userIds || userIds.length === 0) return [];
  const { rows } = await client.query(
    `INSERT INTO notification (user_id, channel, event_type_key, title, body, entity_ref, priority, category)
     SELECT u, 'IN_APP', $2, $3, $4, $5, $6, $7 FROM unnest($1::uuid[]) AS u
     RETURNING notification_id, user_id, created_at`,
    [userIds, eventTypeKey, title, body, entityRef, priority === "HIGH" ? "HIGH" : "NORMAL", category],
  );
  return rows;
}

/**
 * Unread counts for many users in one round-trip — the number the phone's app
 * icon shows.
 *
 * The badge is what makes a missed notification recoverable: a user who swiped
 * a banner away, or whose phone was off when it expired, still sees a "4" on
 * the home screen. Sent with the push rather than computed in the service
 * worker, because the worker has no session and cannot ask.
 *
 * Users with nothing unread are absent from the map, not zero — the caller
 * knows its own default and a row per user would be a row per user.
 */
async function unreadCountsFor(client, userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT user_id, COUNT(*)::int AS n
       FROM notification
      WHERE user_id = ANY($1::uuid[]) AND read_at IS NULL
      GROUP BY user_id`,
    [userIds],
  );
  return new Map(rows.map((r) => [r.user_id, r.n]));
}

/** PERF S5. Deliverable addresses for many users in one round-trip. */
async function activeEmailsFor(client, userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const { rows } = await client.query(
    "SELECT user_id, email, full_name FROM app_user WHERE user_id = ANY($1::uuid[]) AND status = 'ACTIVE'",
    [userIds],
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

module.exports = {
  mine, insertForUser, unreadCount, markRead, markAllRead,
  getPreferences, putPreferences, isChannelEnabled,
  preferencesFor, insertForUsers, activeEmailsFor, unreadCountsFor,
  savePushSubscription, deletePushSubscription,
  setRotationToken, rotatePushSubscription, countPushSubscriptions, listPushSubscriptions,
  claimDeviceLapseNotice, clearDeviceLapse,
  roleRecipients, requesterFor, recipientsWithPermission,
};
