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

/**
 * Minimal branded HTML for a notification email.
 *
 * The font stack names library faces only (Roboto, Noto Sans) over a generic
 * keyword — it used to lead with 'Segoe UI', a proprietary face this product
 * does not ship. Email is the ONE surface that cannot be guaranteed: Outlook and
 * most desktop clients ignore @font-face, so an embedded webfont would be
 * stripped and the recipient's client substitutes regardless. Naming library
 * faces first is the most this surface can honestly do; the generic keyword is
 * what most recipients will actually see.
 */
function notificationEmailHtml({ name, title, body }) {
  const greeting = name ? `Hi ${String(name).trim().split(/\s+/)[0]},` : "Hi,";
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Roboto,'Noto Sans',sans-serif;color:#101e34">
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
    logger.error({ err, user_id: userId }, "[notify] email delivery skipped/failed");
  }
}

/**
 * Best-effort web-push to the user's registered devices. Push is a device-level
 * opt-in (subscribing IS the opt-in), so we mirror the in-app decision: push
 * only when the in-app notification was actually delivered. sendToUser reads the
 * tenant push_subscription table on the caller's client and no-ops cleanly when
 * push isn't configured (no VAPID / web-push). NEVER throws.
 */
async function deliverPush(client, { userId, title, body }) {
  try {
    await pushService.sendToUser(client, { user_id: userId, title, body, url: "/notifications", tag: userId });
  } catch (err) {
    logger.error({ err, user_id: userId }, "[notify] push delivery skipped/failed");
  }
}

/**
 * Canonical notification producer. Derives the category from the event type
 * (unless one is passed), and — for NON-security categories — honours the
 * recipient's per-(channel, category) preferences before delivering. Security
 * categories are unconditional (a user can't silence "your password changed").
 * Writes the IN_APP row (the source of truth) and fans out to EMAIL + web-push
 * best-effort. Returns the inserted in-app row, or null when in-app is
 * suppressed by pref. Runs on the caller's connection so the in-app write can
 * join the triggering transaction; email/push are best-effort side effects.
 */
/**
 * PERF S5. Notify many users with a fixed number of round-trips.
 *
 * The fan-out loop called `notify()` once per recipient, and each call issued
 * ~4-5 further queries: isChannelEnabled(IN_APP), insertForUser,
 * isChannelEnabled(EMAIL), a SELECT on app_user, then the send. For an event
 * notifying 50 finance users — `invoice.posted`, `payment.received` and
 * `dossier.created` are all on the allowlist, so this is the normal path — that
 * is ~250 SEQUENTIAL round-trips WHILE HOLDING A WRITE TRANSACTION OPEN,
 * pinning one of the eight pooled connections and extending the lock window on
 * the business row for the whole duration.
 *
 * This is four queries regardless of recipient count:
 *   1. preferences for everyone, both channels, one statement
 *   2. one multi-row INSERT for the in-app rows
 *   3. addresses for everyone who wants email
 *   4. …then the sends, which are external I/O, not database work
 *
 * The sends stay inside the caller's transaction rather than being deferred.
 * That is a deliberate limit on the scope of this change: moving them out means
 * deciding what happens when the transaction rolls back after an email has
 * gone, which is a correctness question, not a performance one. The queue
 * already exists (BullMQ) and is the right home for them; this change removes
 * the ~246 unnecessary DATABASE round-trips without touching that question.
 */
async function notifyMany(client, userIds, { eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL", category = null }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0 || !title) return 0;

  const cat = category || categoryFor(eventTypeKey);
  const isSecurity = isSecurityCategory(cat);

  // 1. every preference for every recipient, one query.
  const prefs = isSecurity ? new Map() : await repo.preferencesFor(client, ids, ["IN_APP", "EMAIL"], cat);
  // Absence of a row means enabled for IN_APP and disabled for EMAIL — matching
  // the per-user defaults isChannelEnabled was called with.
  const wantsInApp = (u) => isSecurity || prefs.get(`${u}:IN_APP`) !== false;
  const wantsEmail = (u) => isSecurity || prefs.get(`${u}:EMAIL`) === true;

  // 2. one INSERT for all in-app rows.
  const inAppUsers = ids.filter(wantsInApp);
  const inserted = await repo.insertForUsers(client, inAppUsers, {
    eventTypeKey, title, body, entityRef, priority, category: cat,
  });

  // 3. one lookup for all the addresses.
  const emailUsers = ids.filter(wantsEmail);
  const people = await repo.activeEmailsFor(client, emailUsers);

  // 4. external I/O, per recipient by necessity. Best-effort, exactly as
  //    before: one bad address must not roll back a posted invoice.
  for (const userId of emailUsers) {
    const person = people.get(userId);
    if (!person || !person.email) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await emailService.send(client, {
        to: person.email,
        subject: title,
        html: notificationEmailHtml({ name: person.full_name, title, body }),
        text: body ? `${title}\n\n${body}` : title,
        purpose: "NOTIFICATIONS",
        moduleKey: events.MODULE,
      });
    } catch (err) {
      logger.error({ err, user_id: userId }, "[notify] email delivery skipped/failed");
    }
  }

  const pushUsers = ids.filter((u) => isSecurity || inAppUsers.includes(u));
  for (const userId of pushUsers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deliverPush(client, { userId, title, body });
    } catch (err) {
      logger.error({ err, user_id: userId }, "[notify] push delivery skipped/failed");
    }
  }

  return inserted.length;
}

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

  // PUSH fan-out — mirror the in-app decision (delivered in-app, or security).
  if (inApp || isSecurity) {
    await deliverPush(client, { userId, title, body });
  }

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
  notifyMany,
  mine, notify, listCategories, unreadCount, markRead, markAllRead, getPreferences, setPreferences,
  pushPublicKey, subscribePush, unsubscribePush,
};
