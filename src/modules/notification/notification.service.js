/**
 * Notifications — the caller's own inbox. Rows are written by the event engine
 * (Watch-the-Watcher fan-out targets user_id); this module only READS the
 * caller's own notifications and marks them read. Never returns another user's
 * notifications (the previous generic CRUD leaked every tenant row). SQL in repo.
 */
"use strict";
const repo = require("./notification.repo");
const pushService = require("../../shared/push/push.service");
const emailService = require("../../services/email.service");
const { logger } = require("../../config/logger");
const { CATEGORIES, categoryFor, isSecurityCategory } = require("../../shared/notifications/categories");
const events = require("./notification.events");
const { AppError } = require("../../utils/errors");

const mine = (client, actor, q) => repo.mine(client, actor.user_id, q);

/** Minimal branded HTML for a notification email. */
function notificationEmailHtml({ name, title, body }) {
  const greeting = name ? `Hi ${String(name).trim().split(/\s+/)[0]},` : "Hi,";
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101e34">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 12px rgba(16,30,52,.06)">
      <p style="margin:0 0 12px;font-size:13px;color:#84a0b0">${greeting}</p>
      <h1 style="margin:0 0 10px;font-size:18px;color:#101e34">${title}</h1>
      ${body ? `<p style="margin:0;font-size:15px;line-height:1.5;color:#4e6280">${body}</p>` : ""}
      <p style="margin:20px 0 0;font-size:12px;color:#84a0b0">You're receiving this because email is enabled for this kind of alert. Manage it in Notifications → Preferences.</p>
    </div>
  </div></body></html>`;
}

/**
 * Best-effort EMAIL fan-out for a notification. Fetches the recipient's address,
 * honours the per-(EMAIL, category) preference (default OFF — email is opt-in),
 * and sends via the tenant's NOTIFICATIONS identity. Security categories email
 * unconditionally. NEVER throws — a missing SMTP config, no address, or a send
 * failure must not affect the in-app notification or the caller's transaction.
 *
 * NOTE: this performs a network (SMTP) call. Transactional producers should call
 * notify() AFTER their commit so the DB transaction isn't held open across it.
 */
async function deliverEmail(client, { userId, category, isSecurity, title, body }) {
  try {
    if (!isSecurity) {
      const allowed = await repo.isChannelEnabled(client, userId, "EMAIL", category, false);
      if (!allowed) return;
    }
    const { rows } = await client.query(
      "SELECT email, full_name FROM app_user WHERE user_id = $1 AND status = 'ACTIVE'",
      [userId],
    );
    const to = rows[0] && rows[0].email;
    if (!to) return;
    await emailService.send(client, {
      to,
      subject: title,
      html: notificationEmailHtml({ name: rows[0].full_name, title, body }),
      text: body ? `${title}\n\n${body}` : title,
      purpose: "NOTIFICATIONS",
      moduleKey: events.MODULE,
    });
  } catch (err) {
    logger.warn({ err: err.message, user_id: userId }, "[notify] email delivery skipped/failed");
  }
}

/**
 * Canonical notification producer. Derives the category from the event type
 * (unless one is passed), and — for NON-security categories — honours the
 * recipient's per-(channel, category) preferences before delivering. Security
 * categories are unconditional (a user can't silence "your password changed").
 * Writes the IN_APP row (the source of truth) and fans out to EMAIL best-effort.
 * Returns the inserted in-app row, or null when in-app is suppressed by pref.
 * Runs on the caller's connection so the in-app write can join the triggering
 * transaction; email is a best-effort side effect (see deliverEmail).
 */
async function notify(client, { userId, eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL", category = null }) {
  if (!userId || !title) return null;
  const cat = category || categoryFor(eventTypeKey);
  const isSecurity = isSecurityCategory(cat);

  let inApp = null;
  if (isSecurity || (await repo.isChannelEnabled(client, userId, "IN_APP", cat))) {
    inApp = await repo.insertForUser(client, { userId, eventTypeKey, title, body, entityRef, priority, category: cat });
  }

  // EMAIL fan-out (best-effort, own preference check). Runs even when in-app was
  // suppressed, since a user may prefer email-only for a category.
  await deliverEmail(client, { userId, category: cat, isSecurity, title, body });

  return inApp;
}

/** The category catalog for the Preferences UI (label + which are locked-on). */
const listCategories = () => CATEGORIES;
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

// ── Web-Push opt-in ──
// The VAPID public key the browser needs for pushManager.subscribe(). Deploy-wide
// (resolved by shared/push/push.service). null when push isn't configured yet.
const pushPublicKey = async () => ({ public_key: await pushService.getPublicKey() });

async function subscribePush(client, actor, { subscription, userAgent }) {
  const s = subscription || {};
  const keys = s.keys || {};
  if (!s.endpoint || !keys.p256dh || !keys.auth) {
    throw new AppError("INVALID_SUBSCRIPTION", "A valid PushSubscription (endpoint + keys) is required", 422);
  }
  await repo.savePushSubscription(client, actor.user_id, {
    endpoint: s.endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent,
  });
  return { subscribed: true };
}

async function unsubscribePush(client, actor, { endpoint }) {
  await repo.deletePushSubscription(client, actor.user_id, endpoint);
  return { unsubscribed: true };
}

module.exports = {
  mine, notify, listCategories, unreadCount, markRead, markAllRead, getPreferences, setPreferences,
  pushPublicKey, subscribePush, unsubscribePush,
};
