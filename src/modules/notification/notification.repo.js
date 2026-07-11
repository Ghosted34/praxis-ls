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
module.exports = { mine, unreadCount, markRead, markAllRead };
