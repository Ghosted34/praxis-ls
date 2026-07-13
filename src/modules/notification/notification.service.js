/**
 * Notifications — the caller's own inbox. Rows are written by the event engine
 * (Watch-the-Watcher fan-out targets user_id); this module only READS the
 * caller's own notifications and marks them read. Never returns another user's
 * notifications (the previous generic CRUD leaked every tenant row). SQL in repo.
 */
"use strict";
const repo = require("./notification.repo");
const { AppError } = require("../../utils/errors");

const mine = (client, actor, q) => repo.mine(client, actor.user_id, q);
const unreadCount = async (client, actor) => ({ unread: await repo.unreadCount(client, actor.user_id) });
async function markRead(client, { id, actor }) {
  const r = await repo.markRead(client, id, actor.user_id);
  if (!r) throw new AppError("NOT_FOUND", "Notification not found or not yours", 404);
  return { read: true, notification_id: id };
}
const markAllRead = async (client, actor) => ({ marked: await repo.markAllRead(client, actor.user_id) });

// ── Preferences (1.2) — self-service; a user only ever reads/writes their own. ──
const getPreferences = (client, actor) => repo.getPreferences(client, actor.user_id);
const setPreferences = (client, { actor, prefs }) => repo.putPreferences(client, actor.user_id, prefs);

module.exports = { mine, unreadCount, markRead, markAllRead, getPreferences, setPreferences };
