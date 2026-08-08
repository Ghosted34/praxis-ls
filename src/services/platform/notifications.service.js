/**
 * In-house notifications for the platform console (spec §3.3, §5.3).
 *
 * The spec asks for `POST /api/admin/notifications/push` with a `to_user_id`.
 * That is the SHARE case — one admin deliberately sending one error to one
 * colleague — and it is the easy half. The half that matters is escalation:
 * nobody names a recipient at 3am, so `notifyCapable()` resolves the audience
 * from the RBAC matrix instead.
 *
 * TWO DELIVERY LEGS, AND BOTH ARE REQUIRED
 *
 *   The row is the notification. The socket push is a courtesy.
 *
 *   Before this module, escalation's in-house channel was ONLY the socket push.
 *   A socket reaches whoever has the console open at that instant, which for the
 *   rule that exists to catch an overnight outage is nobody — and the event is
 *   gone, because socket.io does not queue for absent clients. The whole feature
 *   worked perfectly in a demo and delivered nothing in production.
 *
 *   So `create()` writes first and pushes second, and a push failure is
 *   swallowed. The inverse — pushing first and treating the write as optional —
 *   is the arrangement that produced the gap.
 *
 * NEVER THROWS ON THE ESCALATION PATH. `notifyCapable()` is called from the
 * escalation evaluator, which runs on a timer and must survive a bad row: a
 * notification failure has to leave the email and webhook channels working. The
 * HTTP path (`send`) does throw, because there a human is waiting for an answer
 * and silently succeeding is worse than a 500.
 */

"use strict";

const db = require("./db");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

const MAX_LIMIT = 100;
/**
 * How long an escalation notification suppresses another for the same signature
 * and recipient. Independent of the rule's `repeat_interval_minutes` on purpose:
 * that interval governs whether the RULE fires, and several rules can match one
 * signature. Without a per-recipient floor, three overlapping rules produce
 * three identical bells for one incident and the bell stops meaning anything.
 */
const ESCALATION_QUIET_MINUTES = 30;

const COLUMNS = `
  n.notification_id AS id,
  n.to_user_id,
  n.from_user_id,
  f.full_name       AS from_name,
  n.type,
  n.title,
  n.body,
  n.metadata,
  n.read_at,
  n.created_at`;

const FROM = `
  FROM platform.notification n
  LEFT JOIN platform.platform_user f ON f.platform_user_id = n.from_user_id`;

/**
 * Write one notification and push it to the recipient's console if they happen
 * to be connected.
 *
 * @param {object} input
 * @param {string} input.toUserId    recipient platform_user_id
 * @param {string|null} [input.fromUserId] sender, NULL for system-generated
 * @param {string} [input.type]      error_escalation | error_share | system
 * @param {string} input.title
 * @param {string} input.body
 * @param {object} [input.metadata]
 */
async function create({ toUserId, fromUserId = null, type = "system", title, body, metadata = {} }) {
  const { rows } = await db.query(
    `INSERT INTO platform.notification (to_user_id, from_user_id, type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING notification_id AS id, to_user_id, type, title, body, metadata, read_at, created_at`,
    [toUserId, fromUserId, type, String(title).slice(0, 300), String(body).slice(0, 4000), JSON.stringify(metadata)],
  );

  const row = rows[0];

  // Best-effort, and required lazily: the realtime layer requires this module
  // back through the escalation service, and a top-level require would close the
  // cycle at load time.
  try {

    require("../../realtime/platform-ns").pushNotification(toUserId, row);
  } catch {
    /* The row is the delivery. A console that is not connected will see it on
       its next poll, which is the entire reason the row exists. */
  }

  return row;
}

/**
 * Who should be told about a platform-wide event.
 *
 * Resolved from the RBAC matrix rather than a configured recipient list, so
 * granting someone `errors.read` in the console is the single action that puts
 * them on call — there is no second list to forget to update. Root Admins are
 * included unconditionally because `requireCap` lets them bypass the capability
 * check, and an audience that excluded the people who can see everything would
 * be the wrong audience.
 */
async function capableUserIds(capability = "errors.read") {
  const { rows } = await db.query(
    `SELECT DISTINCT u.platform_user_id
       FROM platform.platform_user u
       LEFT JOIN platform.platform_role r  ON r.code = u.role
       LEFT JOIN platform.platform_role_permission rp
              ON rp.role_id = r.role_id AND rp.capability = $1
      WHERE u.is_active
        AND (u.role = 'PLATFORM_ROOT_ADMIN' OR rp.capability IS NOT NULL)`,
    [capability],
  );
  return rows.map((r) => r.platform_user_id);
}

/**
 * Has this recipient already been told about this signature recently?
 *
 * The dedupe key is (recipient, signature), NOT (rule, signature) — the rule is
 * an implementation detail of why they were told, and being told twice about one
 * outage because two rules matched is exactly the noise that gets a channel
 * ignored.
 */
async function recentlyNotified(userId, signature) {
  if (!signature) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM platform.notification
      WHERE to_user_id = $1
        AND type = 'error_escalation'
        AND metadata->>'error_signature' = $2
        AND created_at > now() - make_interval(mins => $3::int)
      LIMIT 1`,
    [userId, signature, ESCALATION_QUIET_MINUTES],
  );
  return rows.length > 0;
}

/**
 * Fan an escalation out to everyone who can act on it.
 *
 * Returns a summary rather than throwing, because the caller is the escalation
 * evaluator: a failure here must not prevent the email and webhook channels from
 * firing for the same incident. Losing one channel is a degradation; losing all
 * three because one of them threw is the outage going unreported.
 */
async function notifyCapable({ title, body, metadata = {}, capability = "errors.read" }) {
  try {
    const userIds = await capableUserIds(capability);
    if (!userIds.length) {
      logger.warn({ capability }, "[notifications] escalation had no eligible recipient");
      return { sent: 0, suppressed: 0, recipients: 0 };
    }

    let sent = 0;
    let suppressed = 0;
    for (const userId of userIds) {
      try {

        if (await recentlyNotified(userId, metadata.error_signature)) {
          suppressed += 1;
          continue;
        }

        await create({ toUserId: userId, type: "error_escalation", title, body, metadata });
        sent += 1;
      } catch (err) {
        logger.warn({ err, userId }, "[notifications] could not notify one recipient");
      }
    }

    return { sent, suppressed, recipients: userIds.length };
  } catch (err) {
    logger.warn({ err }, "[notifications] escalation fan-out failed");
    return { sent: 0, suppressed: 0, recipients: 0, error: String(err.message || err) };
  }
}

/** GET /notifications — the bell's list. Always scoped to the caller. */
async function list(userId, { status = "all", limit = 30, before } = {}) {
  const lim = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 30));
  const where = ["n.to_user_id = $1"];
  const params = [userId];

  if (status === "unread") where.push("n.read_at IS NULL");
  else if (status === "read") where.push("n.read_at IS NOT NULL");

  if (before) {
    params.push(before);
    where.push(`n.created_at < $${params.length}`);
  }

  params.push(lim);
  const { rows } = await db.query(
    `SELECT ${COLUMNS} ${FROM}
      WHERE ${where.join(" AND ")}
      ORDER BY n.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** GET /notifications/unread-count — polled, so it is a COUNT and nothing else. */
async function unreadCount(userId) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS unread FROM platform.notification WHERE to_user_id = $1 AND read_at IS NULL",
    [userId],
  );
  return { unread: rows[0] ? rows[0].unread : 0 };
}

/**
 * Mark read. The `to_user_id = $2` predicate is the authorisation check, not a
 * filter — without it any authenticated platform user could mark another user's
 * notification read by guessing a uuid, which is a small thing that quietly
 * makes the unread count untrustworthy.
 *
 * COALESCE keeps the FIRST read time: when someone saw it is the interesting
 * question, and re-opening the bell should not rewrite that answer.
 */
async function markRead(id, userId) {
  const { rows } = await db.query(
    `UPDATE platform.notification
        SET read_at = COALESCE(read_at, now())
      WHERE notification_id = $1 AND to_user_id = $2
      RETURNING notification_id AS id, read_at`,
    [id, userId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Notification not found", 404);
  return rows[0];
}

async function markAllRead(userId) {
  const { rowCount } = await db.query(
    "UPDATE platform.notification SET read_at = now() WHERE to_user_id = $1 AND read_at IS NULL",
    [userId],
  );
  return { marked: rowCount };
}

/**
 * Retention. Read notifications older than the window are noise; UNREAD ones are
 * kept whatever their age, on the same reasoning as an unresolved error group —
 * something nobody has looked at is not something to delete on a schedule.
 */
async function purge({ days = 90 } = {}) {
  const { rowCount } = await db.query(
    `DELETE FROM platform.notification
      WHERE read_at IS NOT NULL AND created_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return { deleted: rowCount, days };
}

module.exports = {
  create,
  notifyCapable,
  capableUserIds,
  recentlyNotified,
  list,
  unreadCount,
  markRead,
  markAllRead,
  purge,
  ESCALATION_QUIET_MINUTES,
};
