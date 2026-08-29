/**
 * "A mail arrived" → a notification, for the people who work that mailbox.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * It did not, and inbound mail raised nothing at all. `syncConnection` emitted
 * `email.thread.created` / `email.thread.replied`, and the domain-event fan-out
 * in shared/notifications/notify-events.js has no `email.*` key on its
 * allowlist — so no in-app row, no email, and above all no push. A user whose
 * phone was in their pocket with the app closed learned about an urgent mail
 * the next time they opened the app, which for the surface this product is
 * built around is the one failure it cannot afford.
 *
 * ── WHY NOT JUST ADD `email.thread.created` TO THE ALLOWLIST ────────────────
 *
 * Two reasons, and both are correctness, not taste.
 *
 * 1. THE EVENT FIRES FOR OUTBOUND TOO. The emit in syncConnection sits outside
 *    the `direction !== "OUT"` guard, so a message this company SENT raises the
 *    same event key as one it received. Notifying off it would tell a team
 *    "new mail" every time one of them replied to a client.
 *
 * 2. THE AUDIENCE WOULD BE WRONG. The allowlist resolves recipients with
 *    `recipientsWithPermission(moduleKey, "view")` — everyone holding MOD-64
 *    view. Mail is not a module-wide broadcast; it belongs to whoever holds the
 *    mailbox. Sending every inbound message to every user with mail permission
 *    is how a channel becomes noise, and a channel that is noise gets muted
 *    wholesale — which loses more mail than raising nothing would.
 *
 * So the audience is resolved from the MAILBOX, exactly as the read-access
 * model already defines it (mail/access.js): the owner, the live members of a
 * shared mailbox, the thread's assignee, and anyone the thread was explicitly
 * shared with.
 *
 * ── PREVIEW CONTENT ─────────────────────────────────────────────────────────
 *
 * Sender, subject and a body snippet, so the notification is readable without
 * unlocking anything. That is a deliberate trade: the same property that makes
 * it useful on a lock screen makes it visible to anyone holding the phone.
 * `mail.notification_preview` (tenant setting, default 'FULL') reduces it to
 * sender + subject for a tenant that would rather not.
 */
"use strict";

const { logger } = require("../../../config/logger");

/** Longest body snippet we put in a notification. Two lines on a phone. */
const SNIPPET_MAX = 140;
/** Notification titles are truncated hard by every OS; this is past the fold. */
const TITLE_MAX = 90;

/**
 * Everyone who should hear about a message on this mailbox, in one round-trip.
 *
 * The four sources mirror `mail/access.js` — that file decides who may READ a
 * mailbox, and telling someone about mail they cannot open would be both
 * useless and a disclosure. A PERSONAL mailbox has no member rows, so the owner
 * branch is the whole answer for it; a SHARED one adds its live grants.
 */
async function recipientsFor(client, { connectionId, ownerUserId, threadId, assignedUserId }) {
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
      WHERE u.status = 'ACTIVE'
        AND (
          u.user_id = $2
          OR u.user_id = $4
          OR EXISTS (
            SELECT 1 FROM email_connection_member m
             WHERE m.email_connection_id = $1
               AND m.user_id = u.user_id
               AND m.revoked_at IS NULL)
          OR EXISTS (
            SELECT 1 FROM email_thread_share s
             WHERE s.email_thread_id = $3
               AND s.user_id = u.user_id)
        )`,
    [connectionId, ownerUserId || null, threadId || null, assignedUserId || null],
  );
  return rows.map((r) => r.user_id);
}

/**
 * "Ama Boateng <ama@client.cm>" → "Ama Boateng"; a bare address → the address.
 * Falls back to the whole string rather than to nothing: a notification headed
 * "New mail" tells the reader strictly less than a raw address would.
 */
function senderName(from) {
  const s = String(from || "").trim();
  if (!s) return "Unknown sender";
  const named = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (named && named[1].trim()) return named[1].trim();
  const bare = s.match(/<([^>]+)>/);
  return (bare ? bare[1] : s).trim();
}

/**
 * The first thing the sender actually wrote.
 *
 * Quoted history is dropped, because on a reply it is the LONGEST part of the
 * body and it is the part the reader has already seen — a snippet made of it
 * says "> On Monday you wrote" and nothing about why the phone just buzzed.
 */
function snippet(bodyText, max = SNIPPET_MAX) {
  const lines = String(bodyText || "").split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(">")) break;                       // quoted reply block
    if (/^On .+ wrote:$/i.test(t)) break;               // the header above one
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(t)) break;
    if (/^_{5,}$/.test(t) || /^-{5,}$/.test(t)) break;  // signature rules
    kept.push(t);
  }
  const text = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const clamp = (s, max) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * Tenant preference for how much of a message a notification may quote.
 * FULL (default) = sender + subject + snippet; MINIMAL = sender + subject.
 * Never throws — an unreadable setting must not cost the notification.
 */
async function previewMode(client, ctx = null) {
  // Memoised on the SYNC RUN'S ctx object, not at module scope: a module-level
  // cache is shared by every tenant in the process, and one tenant's privacy
  // setting deciding another tenant's notification previews is exactly the
  // cross-tenant leak this codebase is built to make impossible. Per-run is
  // also the right grain — a first sync can ingest hundreds of messages, and
  // this would otherwise be a settings query for each one.
  if (ctx && ctx.__mailPreviewMode) return ctx.__mailPreviewMode;
  const mode = await readPreviewMode(client);
  if (ctx) ctx.__mailPreviewMode = mode;
  return mode;
}

async function readPreviewMode(client) {
  try {
    const setting = require("../../security/setting/setting.service");
    // `get` THROWS AppError(NOT_FOUND) when the key was never written, which is
    // the normal state — a tenant that has not touched this preference has no
    // row. The catch below is that path, not an error path, and FULL is the
    // documented default.
    const row = await setting.get(client, "mail", "notification_preview");
    // Settings are stored as jsonb, so the value arrives as a bare string, or
    // wrapped in an object by an editor that writes { value }. Both are read.
    const raw = row && (typeof row.value === "object" && row.value !== null ? row.value.value : row.value);
    return String(raw || "FULL").toUpperCase() === "MINIMAL" ? "MINIMAL" : "FULL";
  } catch {
    /* @silent:storage the setting table may not be provisioned; FULL is the
       documented default and the useful one. */
    return "FULL";
  }
}

/**
 * Build the notification text for one inbound message.
 *
 * The title carries WHO, and — on a shared mailbox — which mailbox, because
 * "Ama Boateng" alone does not tell a person working billing@ and ops@ which
 * hat to put on. The body carries the subject and the snippet, which is the
 * order a human reads them in.
 */
function compose({ from, subject, bodyText, mailboxLabel = null, mode = "FULL" }) {
  const who = senderName(from);
  const title = clamp(mailboxLabel ? `${who} → ${mailboxLabel}` : who, TITLE_MAX);
  const subj = clamp(subject, 120) || "(no subject)";
  if (mode === "MINIMAL") return { title, body: subj };
  const snip = snippet(bodyText);
  return { title, body: snip ? `${subj} — ${snip}` : subj };
}

/**
 * Raise the notification for ONE inbound message. Best-effort by contract: it
 * is called from inside the sync loop, and a notification failure must never be
 * what stops a mailbox from syncing.
 *
 * Returns { notified } — the number of in-app rows written — or { notified: 0,
 * skipped } when there was nobody to tell or the message was outbound.
 */
async function onInboundMessage(client, { conn, message, row, ctx = {}, isFirstSync = false }) {
  try {
    if (!row || !conn) return { notified: 0, skipped: "nothing ingested" };
    // Outbound mail is not news to the people who sent it. The emit above this
    // call site does not make this distinction, which is exactly why the
    // notification is raised here rather than off the event.
    if (message && message.direction === "OUT") return { notified: 0, skipped: "outbound" };
    // THE BACKFILL. A newly connected mailbox syncs its history — the folder
    // has no `last_sync_at` exactly once, and that pass can be ninety days
    // deep. Notifying on it would fire hundreds of pushes at once for mail
    // that is weeks old and long since dealt with, and the only thing anybody
    // would do about that is turn notifications off for good. The same
    // narrowing the OCR queue makes for the same reason (ocr.enqueue.js).
    if (isFirstSync) return { notified: 0, skipped: "first sync" };

    const { rows: threads } = await client.query(
      `SELECT email_thread_id, subject, assigned_user_id, is_vip, stream
         FROM email_thread WHERE email_thread_id = $1`,
      [row.thread_id],
    );
    const thread = threads[0] || {};

    // SYSTEM stream is the machine half of the split inbox (10734) — delivery
    // receipts, no-reply bulletins, monitoring mail. It is real mail and it is
    // kept, but it is not somebody trying to reach a person, and pushing it to
    // a phone at 3am is how the whole channel gets turned off.
    if (thread.stream === "SYSTEM") return { notified: 0, skipped: "system stream" };

    const userIds = await recipientsFor(client, {
      connectionId: conn.email_connection_id,
      ownerUserId: conn.owner_user_id,
      threadId: row.thread_id,
      assignedUserId: thread.assigned_user_id,
    });
    if (!userIds.length) return { notified: 0, skipped: "no recipients" };

    const mode = await previewMode(client, ctx);
    const { title, body } = compose({
      from: message && message.from,
      subject: (message && message.subject) || thread.subject,
      bodyText: message && message.bodyText,
      mailboxLabel: conn.kind === "PERSONAL" ? null : conn.email_address,
      mode,
    });

    const notifications = require("../../notification/notification.service");
    return {
      notified: await notifications.notifyMany(client, userIds, {
        eventTypeKey: row.is_new_thread ? "email.thread.created" : "email.thread.replied",
        title,
        body,
        entityRef: `email_thread:${row.thread_id}`,
        category: "comms",
        priority: thread.is_vip ? "HIGH" : "NORMAL",
        // The tap target is the CONVERSATION, not the notifications list. A
        // push that lands on a generic inbox has made the user do the finding
        // twice.
        url: `/comms/mail?thread=${row.thread_id}`,
        // Collapse per THREAD, not per user. Twenty messages on one noisy
        // thread become one notification showing the latest; two messages on
        // two different threads stay two notifications. `renotify` keeps the
        // collapsed replacement audible — silently swapping the text of a
        // notification nobody looked at is the same as losing it.
        pushTag: `mail:${row.thread_id}`,
        renotify: true,
        // Web Push urgency. At "normal" a dozing handset may not be woken for
        // tens of minutes, which for mail is indistinguishable from not being
        // notified at all.
        urgency: "high",
        // If no device is registered, or every send fails, fall back to email
        // even when the user has not opted into email for this category. This
        // is the whole reliability promise: a notification that reaches no
        // device must reach the person some other way.
        emailFallback: true,
        pushData: { kind: "mail", thread_id: row.thread_id, message_id: row.email_message_id },
        ctx,
      }),
    };
  } catch (err) {
    logger.warn({ err, message_id: row && row.email_message_id }, "[mail-notify] notification skipped");
    return { notified: 0, skipped: "error" };
  }
}

module.exports = { onInboundMessage, recipientsFor, compose, senderName, snippet, previewMode };
