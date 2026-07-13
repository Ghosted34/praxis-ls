/** Notification repository. Everything is scoped to the caller's user_id — a
 *  user only ever reads/marks their OWN notifications. All SQL lives here. */
"use strict";
const { page } = require("../../shared/db/query-helpers");

async function mine(client, userId, q = {}) {
  const { limit, offset } = page(q);
  const params = [userId, limit, offset]; const wh = ["user_id = $1"];
  if (q.unread === "true" || q.unread === true) wh.push("read_at IS NULL");
  if (q.channel) { params.push(q.channel); wh.push("channel = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM notification WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $2 OFFSET $3", params);
  return rows;
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
/**
 * Enforcement helper: has this user opted OUT of (channel, category)?
 * Returns true when delivery is allowed (default enabled when no row exists).
 * Any future notification-writing path MUST consult this before inserting a
 * non-security notification (security-critical alerts are unconditional).
 */
async function isChannelEnabled(client, userId, channel, category) {
  const { rows } = await client.query(
    "SELECT enabled FROM notification_preference WHERE user_id = $1 AND channel = $2 AND category = $3",
    [userId, channel, category]);
  return rows[0] ? rows[0].enabled === true : true;
}
module.exports = { mine, unreadCount, markRead, markAllRead, getPreferences, putPreferences, isChannelEnabled };
