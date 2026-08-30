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
 *
 * ── WHICH MESSAGES COUNT AS NEWS ────────────────────────────────────────────
 *
 * A FRESHNESS window on the message's own timestamp, not a test of whether the
 * sync has run before.
 *
 * The first version asked `!folder.last_sync_at` — "is this the first time we
 * have looked at this folder?" — to keep a ninety-day backfill from firing
 * hundreds of alerts at once. That works for the backfill and is wrong twice
 * over, because it is a question about the SYNC and the thing we need to know
 * is a question about the MESSAGE:
 *
 *   - Mail that genuinely arrives DURING a first sync is silent. Connect a
 *     mailbox at 09:00 and a client writes at 09:01; that message lands in the
 *     same first pass and nobody is told.
 *   - A folder created later is a "first sync" too. Someone makes a `Clients`
 *     folder and moves two hundred old mails into it — rightly quiet — but a
 *     new mail landing there during that pass is lost with them.
 *
 * `received_at` comes from the provider's own date header, so a backfill
 * carries old timestamps and a mail that just arrived carries a fresh one. One
 * window answers both cases, and keeps answering them for folders that do not
 * exist yet.
 *
 * ── AND A CIRCUIT BREAKER BEHIND IT ─────────────────────────────────────────
 *
 * The window trusts a timestamp a third party wrote. A mail server with a
 * skewed clock, or a message with no parseable date (which falls back to
 * `now()` at ingest), can present old mail as new. So a run may notify
 * individually at most PER_RUN_CAP times per mailbox; past that the remainder
 * arrives as ONE digest — "18 more new messages in billing@". Nothing is
 * hidden, and nothing can fire three hundred pushes at a phone.
 */
"use strict";

const { logger } = require("../../../config/logger");

/** Longest body snippet we put in a notification. Two lines on a phone. */
const SNIPPET_MAX = 140;
/** Notification titles are truncated hard by every OS; this is past the fold. */
const TITLE_MAX = 90;

/**
 * How recently a message must have arrived to be worth a notification.
 *
 * An hour, not minutes: the window has to absorb a sync that was late rather
 * than punish the mail it was late to fetch. A wedged IMAP connection, a worker
 * restart, a provider having a bad ten minutes — all of them delay the fetch,
 * none of them makes the mail less urgent, and a tight window would silently
 * drop exactly the messages a recovery is catching up on. An hour is also far
 * short of a backfill, which reaches back ninety days.
 */
const FRESH_WINDOW_MS = 60 * 60 * 1000;

/**
 * Individual notifications per mailbox per sync run, before the rest collapse
 * into one digest. Twenty is comfortably above a busy morning on a shared
 * inbox and far below what a repaired cursor or a skewed clock could produce.
 */
const PER_RUN_CAP = 20;

/**
 * Per-run, per-mailbox tally, carried on the sync run's own ctx object.
 *
 * On ctx rather than at module scope for the same reason the preview setting
 * is: module state is shared by every tenant in the process, and one tenant's
 * counters throttling another tenant's notifications would be both a bug and a
 * cross-tenant leak.
 */
function runState(ctx, connectionId) {
  if (!ctx || !connectionId) return null;
  if (!ctx.__mailNotify) ctx.__mailNotify = new Map();
  let state = ctx.__mailNotify.get(connectionId);
  if (!state) {
    state = { notified: 0, suppressed: 0, label: null };
    ctx.__mailNotify.set(connectionId, state);
  }
  return state;
}

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
 * Is this message recent enough to be news?
 *
 * A missing or unparseable timestamp counts as FRESH. Ingest already defaults
 * `received_at` to `now()` when the provider gave nothing usable, so a null
 * here means something unusual rather than something old — and the failure to
 * prefer is a notification too many, which the per-run cap bounds, over a
 * silently dropped mail, which is the thing this whole path exists to prevent.
 */
function isFresh(receivedAt, now = Date.now()) {
  if (!receivedAt) return true;
  const t = receivedAt instanceof Date ? receivedAt.getTime() : Date.parse(receivedAt);
  if (!Number.isFinite(t)) return true;
  // A timestamp in the FUTURE is a skewed sender clock, not a message from
  // tomorrow. Treated as fresh: it just arrived, whatever it claims.
  return t >= now - FRESH_WINDOW_MS;
}

/**
 * Raise the notification for ONE inbound message. Best-effort by contract: it
 * is called from inside the sync loop, and a notification failure must never be
 * what stops a mailbox from syncing.
 *
 * Returns { notified } — the number of in-app rows written — or { notified: 0,
 * skipped } when there was nobody to tell or the message was outbound.
 */
async function onInboundMessage(client, { conn, message, row, ctx = {} }) {
  try {
    if (!row || !conn) return { notified: 0, skipped: "nothing ingested" };
    // Outbound mail is not news to the people who sent it. The emit above this
    // call site does not make this distinction, which is exactly why the
    // notification is raised here rather than off the event.
    if (message && message.direction === "OUT") return { notified: 0, skipped: "outbound" };
    // THE FRESHNESS WINDOW — see the header. A backfill carries the provider's
    // own old timestamps and is filtered here by age, which also lets a mail
    // that genuinely arrives mid-backfill through. `received_at` is preferred
    // over the raw message because ingest has already applied its `|| now()`
    // fallback, so there is one definition of when a message arrived.
    if (!isFresh(row.received_at || (message && message.receivedAt))) {
      return { notified: 0, skipped: "not fresh" };
    }

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

    // THE CIRCUIT BREAKER. Past the cap this run stops notifying one-by-one and
    // starts counting; flushRun below turns the remainder into a single digest.
    // Recipients and the mailbox label are remembered from the messages that
    // DID notify, so the digest reaches the same people without another query.
    const state = runState(ctx, conn.email_connection_id);
    if (state) {
      state.label = conn.kind === "PERSONAL" ? null : conn.email_address;
      if (state.notified >= PER_RUN_CAP) {
        state.suppressed += 1;
        return { notified: 0, skipped: "capped" };
      }
      state.notified += 1;
    }

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

/**
 * End of a sync run for one mailbox: if the cap held anything back, say so once.
 *
 * ── WHY A DIGEST AND NOT SILENCE ────────────────────────────────────────────
 *
 * The cap exists to stop a runaway — a repaired cursor, a re-connected mailbox,
 * a server stamping old mail with today's date — from firing three hundred
 * pushes at somebody's phone. But "stop notifying" and "pretend it did not
 * happen" are different things, and only the first one is defensible in a
 * product whose whole promise here is that mail does not get missed. So the
 * remainder arrives as one line: the user knows exactly how much is waiting and
 * where, and one tap takes them to it.
 *
 * Called once per connection after its folder loop, and best-effort like
 * everything else on this path.
 */
async function flushRun(client, { conn, ctx = {} } = {}) {
  try {
    const state = ctx && ctx.__mailNotify && conn
      ? ctx.__mailNotify.get(conn.email_connection_id)
      : null;
    if (!state || state.suppressed <= 0) {
      return { notified: 0, skipped: "nothing held back" };
    }

    // MAILBOX-scoped recipients, resolved fresh — not the audience of whichever
    // message happened to be notified last. Per-message recipients include a
    // thread's assignee and anyone it was individually shared with, and those
    // people have no standing to be counted into a summary of a mailbox they do
    // not otherwise work. Passing no thread reduces the same query to the
    // mailbox's own owner and live members.
    const recipients = await recipientsFor(client, {
      connectionId: conn.email_connection_id,
      ownerUserId: conn.owner_user_id,
      threadId: null,
      assignedUserId: null,
    });
    if (!recipients.length) return { notified: 0, skipped: "no recipients" };

    const n = state.suppressed;
    const where = state.label ? ` in ${state.label}` : "";
    const notifications = require("../../notification/notification.service");
    const notified = await notifications.notifyMany(client, recipients, {
      eventTypeKey: "email.thread.created",
      title: `${n} more new message${n === 1 ? "" : "s"}${where}`,
      body: "Open the mailbox to read them.",
      entityRef: `email_connection:${conn.email_connection_id}`,
      category: "comms",
      url: "/comms/mail",
      // Collapse on the MAILBOX: a second run that also overflows should
      // replace this line rather than stack a second count beside it, because
      // the newer number already includes the older one.
      pushTag: `mail-digest:${conn.email_connection_id}`,
      renotify: true,
      urgency: "high",
      emailFallback: true,
      pushData: { kind: "mail-digest", connection_id: conn.email_connection_id, count: n },
      ctx,
    });
    // Reset so a long-lived ctx cannot re-send the same digest.
    state.suppressed = 0;
    state.notified = 0;
    return { notified, digested: n };
  } catch (err) {
    logger.warn({ err }, "[mail-notify] digest skipped");
    return { notified: 0, skipped: "error" };
  }
}

module.exports = {
  onInboundMessage, flushRun, recipientsFor, compose, senderName, snippet,
  previewMode, isFresh, FRESH_WINDOW_MS, PER_RUN_CAP,
};
