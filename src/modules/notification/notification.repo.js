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
    // eslint-disable-next-line no-await-in-loop
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
async function savePushSubscription(client, userId, { endpoint, p256dh, auth, userAgent }) {
  const { rows } = await client.query(
    `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, last_used_at = now()
     RETURNING subscription_id`,
    [userId, endpoint, p256dh, auth, userAgent || null],
  );
  return rows[0];
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
module.exports = {
  mine, insertForUser, unreadCount, markRead, markAllRead,
  getPreferences, putPreferences, isChannelEnabled,
  savePushSubscription, deletePushSubscription,
  roleRecipients, requesterFor, recipientsWithPermission,
};
