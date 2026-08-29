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
 * Send ONE notification email, via the tenant's NOTIFICATIONS identity. NEVER
 * throws — a missing SMTP config, no address, or a send failure must not affect
 * the in-app notification or the caller's transaction.
 *
 * ── WHY IT NEITHER CHECKS THE PREFERENCE NOR LOOKS UP THE ADDRESS ───────────
 *
 * Both were done here, once per recipient, which put the per-user preference
 * query and a per-user `app_user` SELECT back on a path that PERF S5 had
 * deliberately batched — a fan-out to fifty finance users meant a hundred extra
 * round-trips. The decision and the address now arrive with the delivery plan,
 * resolved in one query each by the producer, and this function does the one
 * thing its name says.
 *
 * NOTE: this performs a network (SMTP) call. Transactional producers should call
 * notify() AFTER their commit so the DB transaction isn't held open across it —
 * or pass `ctx.tenantMeta`, which moves the whole of delivery onto the queue.
 */
async function deliverEmail(client, { userId, person, isSecurity, title, body }) {
  try {
    const to = person && person.email;
    if (!to) return false;
    await emailService.send(client, {
      to,
      subject: title,
      html: notificationEmailHtml({ name: person.full_name, title, body }),
      text: body ? `${title}\n\n${body}` : title,
      purpose: "NOTIFICATIONS",
      moduleKey: events.MODULE,
      // Security notices are a different send point from ordinary alerts,
      // because they are the ones a tenant most often wants coming from an
      // address people recognise — and they are also the ones nobody can
      // silence, so the From matters more, not less.
      sendPoint: isSecurity ? "notification.security" : "notification.alert",
    });
    return true;
  } catch (err) {
    logger.error({ err, user_id: userId }, "[notify] email delivery skipped/failed");
    return false;
  }
}

/**
 * Best-effort web-push to the user's registered devices. Push is a device-level
 * opt-in (subscribing IS the opt-in), so we mirror the in-app decision: push
 * only when the in-app notification was actually delivered. sendToUser reads the
 * tenant push_subscription table on the caller's client and no-ops cleanly when
 * push isn't configured (no VAPID / web-push). NEVER throws.
 *
 * Returns sendToUser's result so the caller can tell "no device registered"
 * from "three devices, all failed" — the email fallback turns on that
 * distinction.
 */
async function deliverPush(client, { userId, title, body, url = "/notifications", tag, renotify, requireInteraction, urgency, badgeCount, data, actions }) {
  try {
    return await pushService.sendToUser(client, {
      user_id: userId,
      title, body, url,
      // The old code sent `tag: userId` here, which told the OS that every
      // notification for a user REPLACED the previous one — five urgent mails
      // arrived and the phone showed one. Undefined unless a caller asks for
      // collapsing on a key that means something (a mail thread), which is the
      // only kind of collapsing that is ever right.
      tag,
      renotify, requireInteraction, urgency, badgeCount, data, actions,
    });
  } catch (err) {
    logger.error({ err, user_id: userId }, "[notify] push delivery skipped/failed");
    return { sent: 0, failed: 0, total: 0, reason: "threw" };
  }
}

/**
 * The outbound half of a notification: push to every registered device, email
 * where the recipient wants it, and email ANYWAY where push reached nothing.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT TWO LOOPS AT THE CALL SITES ────────────
 *
 * It runs from two places — inline, on the caller's connection, and from the
 * `notification-deliver` job on a fresh one. Those must not be two
 * implementations: the queued path is the one that runs in production and the
 * inline path is the one the tests exercise, so a divergence between them is a
 * bug that only ever shows up live.
 *
 * ── THE FALLBACK RULE ───────────────────────────────────────────────────────
 *
 * When `emailFallback` is set and push delivered to ZERO devices, the email
 * goes out regardless of the EMAIL preference. That is the difference between
 * "we tried" and "they know". Two carve-outs, and both matter:
 *
 *   - It does NOT fire when the recipient SILENCED this category (`push:
 *     false`). Push was never attempted for them, and emailing anyway would
 *     route around an opt-out the user made on purpose.
 *   - It does NOT fire when push is unconfigured DEPLOYMENT-wide (`reason:
 *     "push not configured"`). That is an operations problem — no VAPID
 *     keypair — and papering over it with an email per notification would hide
 *     it while flooding every inbox. It is logged at error level instead.
 */
async function deliverOutbound(client, { recipients, notification }) {
  const {
    title, body = null, isSecurity = false,
    url = "/notifications", tag, renotify = false, requireInteraction = false,
    urgency = "normal", data = null, actions = null, emailFallback = false,
  } = notification || {};

  const list = (recipients || []).filter((r) => r.userId || r.user_id);
  if (!list.length) return { pushed: 0, emailed: 0, fellBack: 0, recipients: 0 };

  // Every address that could be needed, in ONE query — the recipients who want
  // email, plus (when the fallback is armed) the ones who might turn out to
  // need it because push reached nothing. Doing this per recipient inside the
  // loop is what PERF S5 removed and what an earlier draft of this function
  // quietly reintroduced.
  const mayEmail = list
    .filter((r) => r.email || emailFallback)
    .map((r) => r.userId || r.user_id);
  // `Promise.resolve(...)` because a repo double in a test may answer
  // synchronously, and calling `.catch` on a bare value throws.
  const people = mayEmail.length
    ? (await Promise.resolve(repo.activeEmailsFor(client, mayEmail)).catch(() => null)) || new Map()
    : new Map();

  let pushed = 0;
  let emailed = 0;
  let fellBack = 0;

  for (const r of list) {
    const userId = r.userId || r.user_id;

    // `push: false` means the recipient silenced this category in the product.
    // Not attempted, and — critically — NOT a trigger for the email fallback:
    // falling back for somebody who opted out would route around the opt-out.
    const suppressed = r.push === false;
     
    const push = suppressed
      ? { sent: 0, reason: "suppressed by preference" }
       
      : await deliverPush(client, {
        userId, title, body, url, tag, renotify, requireInteraction, urgency,
        badgeCount: Number.isFinite(r.badgeCount) ? r.badgeCount : null,
        data, actions,
      });
    pushed += push.sent || 0;

    if (push.reason === "push not configured") {
      logger.error(
        { user_id: userId },
        "[notify] web-push is not configured on this deployment — no VAPID keypair. " +
        "Notifications cannot reach a closed app until one is generated in the Platform Console.",
      );
    }

    const person = people.get(userId);
    if (r.email) {
       
      if (await deliverEmail(client, { userId, person, isSecurity, title, body })) emailed += 1;
    } else if (
      emailFallback
      && !suppressed
      && !(push.sent > 0)
      && push.reason !== "push not configured"
    ) {
      // Nothing reached a device, and the recipient did not ask for silence.
      // Email is the last channel that can still reach this person today, so it
      // goes out over the (opt-in, default-off) email preference.
       
      if (await deliverEmail(client, { userId, person, isSecurity, title, body })) {
        emailed += 1;
        fellBack += 1;
      }
    }
  }

  return { pushed, emailed, fellBack, recipients: list.length };
}

/**
 * The tenant this delivery belongs to, for the queue — or null when we cannot
 * tell, in which case delivery stays inline.
 *
 * A caller inside a worker already holds `tenantMeta` and passes it through
 * `ctx`. A caller on a request path does not, but the ambient request context
 * carries the tenant slug (config/request-context, set by the tenant-context
 * middleware), which resolves to the same metadata. The result is memoised for
 * a minute because it is a platform-database read on the path of every
 * notification and the answer changes about never.
 */
const TENANT_META_TTL_MS = 60_000;
const tenantMetaCache = new Map();

async function resolveTenantMeta(ctx = {}) {
  if (ctx && ctx.tenantMeta) return ctx.tenantMeta;
  try {
     
    const requestContext = require("../../config/request-context");
    const slug = requestContext.getTenant();
    if (!slug) return null;
    const hit = tenantMetaCache.get(slug);
    if (hit && Date.now() - hit.at < TENANT_META_TTL_MS) return hit.meta;
     
    const registry = require("../../services/tenant/registry.service");
    const meta = await registry.resolveBySlug(slug);
    tenantMetaCache.set(slug, { meta, at: Date.now() });
    return meta;
  } catch {
    /* @silent:storage the platform lookup failed; inline delivery is the
       defined degradation and is what happened before the queue existed. */
    return null;
  }
}

/**
 * Hand the outbound half to the worker, or report that we could not.
 *
 * ── WHY THE QUEUE, AND WHY IT MATTERS MOST FOR MAIL ─────────────────────────
 *
 * Inline, an SMTP send and one HTTPS request per registered device happen while
 * the producer's WRITE TRANSACTION IS STILL OPEN — pinning a pooled connection
 * and holding locks on the business row for the length of two network calls to
 * third parties. Worse, there is no retry: a transient 500 from FCM meant the
 * notification was logged at warn level and gone for ever. For the one category
 * the product cannot afford to drop, "best-effort, once" is not good enough.
 *
 * Queued, delivery gets BullMQ's five attempts with exponential backoff and a
 * dead-letter, and the transaction closes as soon as the in-app rows are
 * written.
 *
 * Returns false when there is no tenant context or no Redis — the caller then
 * delivers inline, exactly as before, so nothing depends on the queue being up.
 */
async function enqueueDelivery(ctx, { recipients, notification }) {
  if (!recipients || !recipients.length) return true;
  const tenantMeta = await resolveTenantMeta(ctx);
  if (!tenantMeta) return false;
  try {
     
    const { enqueue } = require("../../jobs/queue-producer");
    await enqueue(
      "notification-deliver",
      "deliver",
      { tenantMeta, env: (ctx && ctx.env) || "live", recipients, notification },
      // The default five attempts with exponential backoff. A push service
      // returning 5xx is the case this exists for and it is usually over in
      // seconds; `removeOnFail` is kept so a persistent failure stays visible
      // in the queue rather than being swept away.
      { removeOnComplete: 500, removeOnFail: 500 },
    );
    return true;
  } catch (err) {
    logger.warn({ err }, "[notify] could not queue delivery — falling back to inline");
    return false;
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
async function notifyMany(client, userIds, {
  eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL", category = null,
  url = "/notifications", pushTag = undefined, renotify = false, requireInteraction = false,
  urgency = "normal", pushData = null, actions = null, emailFallback = false, ctx = {},
} = {}) {
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

  // 3. the badge number each recipient's phone should show, one query. Read
  //    AFTER the insert so the count includes the notification being delivered.
  const badges = await repo.unreadCountsFor(client, ids).catch(() => new Map());

  // 4. the outbound plan. Push mirrors the in-app decision (delivered in-app,
  //    or security) exactly as it did before — a user who silenced a category
  //    in the product has not asked to be woken by it on a phone.
  const inAppSet = new Set(inAppUsers);
  const recipients = ids.map((userId) => ({
    userId,
    email: wantsEmail(userId),
    push: isSecurity || inAppSet.has(userId),
    badgeCount: badges.get(userId) ?? null,
  })).filter((r) => r.email || r.push);

  const notification = {
    title, body, category: cat, isSecurity,
    url, tag: pushTag, renotify, requireInteraction, urgency,
    data: pushData, actions, emailFallback,
  };

  // 5. delivery. Queued where we can tell which tenant this is — that takes the
  //    SMTP and web-push calls out of the caller's open transaction and buys
  //    them retries. Inline otherwise, which is what always happened and what
  //    the unit tests exercise.
  if (!(await enqueueDelivery(ctx, { recipients, notification }))) {
    await deliverOutbound(client, { recipients, notification });
  }

  return inserted.length;
}

const DEDUPE_MS = 60_000;
const DEDUPE_TTL_S = Math.ceil(DEDUPE_MS / 1000);
const recentDedupe = new Map();

function shouldDedupe(key) {
  if (!key) return false;
  const now = Date.now();
  const prev = recentDedupe.get(key);
  if (prev && now - prev < DEDUPE_MS) return true;
  recentDedupe.set(key, now);
  if (recentDedupe.size > 5000) recentDedupe.delete(recentDedupe.keys().next().value);
  return false;
}

/**
 * P5-2. The in-memory Map is correct inside one process and wrong everywhere
 * else: two API replicas, or a worker restart inside the 60s window, both
 * deliver the same event twice. Redis `SET NX EX 60` is the same 60-second
 * claim across the fleet. The Map stays as the fallback when Redis is down
 * or uninitialised (tests, a cold boot) so the guarantee degrades to
 * process-local rather than disappearing.
 *
 * Returns true when this key has already been claimed inside the window.
 */
function tryRedis() {
  try {
    return require("../../config/redis").getClient();
  } catch {
    return null;
  }
}

async function claimDedupe(key) {
  if (!key) return false;
  const redis = tryRedis();
  if (redis) {
    try {
      const ok = await redis.set(`notify:dedupe:${key}`, "1", "NX", "EX", DEDUPE_TTL_S);
      if (ok === null) return true;
      if (ok === "OK") return false;
    } catch {
      /* @silent:storage Redis down — degrade to the process-local map */
    }
  }
  return shouldDedupe(key);
}

async function notify(client, {
  userId, eventTypeKey = null, title, body = null, entityRef = null, priority = "NORMAL",
  category = null, dedupeKey = null,
  url = "/notifications", pushTag = undefined, renotify = false, requireInteraction = false,
  urgency = "normal", pushData = null, actions = null, emailFallback = false, ctx = {},
} = {}) {
  if (!userId || !title) return null;
  const cat = category || categoryFor(eventTypeKey);
  const isSecurity = isSecurityCategory(cat);
  if (dedupeKey && await claimDedupe(dedupeKey)) {
    return null;
  }

  let inApp = null;
  if (isSecurity || (await repo.isChannelEnabled(client, userId, "IN_APP", cat))) {
    inApp = await repo.insertForUser(client, { userId, eventTypeKey, title, body, entityRef, priority, category: cat });
  }

  // The recipient's badge number, read after the insert so it counts this one.
  let badgeCount = null;
  try {
    badgeCount = await repo.unreadCount(client, userId);
  } catch {
    /* @silent:storage the badge is an enrichment; a notification without one
       still arrives, it just does not update the number on the app icon. */
  }

  // EMAIL fan-out honours its own preference (checked inside deliverOutbound
  // via the `email` flag below); PUSH mirrors the in-app decision, since a user
  // who silenced a category in the product has not asked for it on a phone.
  const wantsEmail = isSecurity || (await repo.isChannelEnabled(client, userId, "EMAIL", cat, false));
  const recipients = [{ userId, email: wantsEmail, push: Boolean(inApp) || isSecurity, badgeCount }];
  const notification = {
    title, body, category: cat, isSecurity,
    url, tag: pushTag, renotify, requireInteraction, urgency,
    data: pushData, actions, emailFallback,
  };

  if (!(await enqueueDelivery(ctx, { recipients, notification }))) {
    await deliverOutbound(client, { recipients, notification });
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
  DEDUPE_MS, DEDUPE_TTL_S, shouldDedupe, claimDedupe, recentDedupe,
  notifyMany, deliverOutbound, resolveTenantMeta,
  mine, notify, listCategories, unreadCount, markRead, markAllRead, getPreferences, setPreferences,
  pushPublicKey, subscribePush, unsubscribePush,
};
