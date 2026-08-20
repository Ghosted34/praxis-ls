/**
 * Mention fan-out (§7.4) — three channels, exactly once each.
 *
 * The rule from the guide, verbatim in shape: on note save, for each mention,
 * write the `mention` row and then notify ONCE via
 *   1. in-app   — notification.service, category MENTION, deep-linked to the thread,
 *   2. chat     — a compact card in the mentioned person's direct channel,
 *   3. push     — the existing web-push path.
 *
 * As merged, only (1) happened. (3) came free with it — `notification.notify`
 * already fans out to push — but (2) did not exist, which is the half the brief
 * described most concretely ("goes to the in-house chat box directly").
 *
 * ── WHY THE CHAT CARD DOES NOT RAISE ITS OWN NOTIFICATION ───────────────────
 *
 * `smartcomm.postMessage` notifies every other member of the channel. Left
 * alone, a mention would therefore arrive twice — once as a mention, once as
 * "new message in Smart Comms" — from ONE logical event, which is exactly what
 * addition (f)'s dedup rule forbids. The card is posted with
 * `notifyMembers: false`; the mention notification is the one that fires.
 *
 * Deduplication lives in `notification.service` behind `dedupeKey`, per the
 * MUST in §7.4 ("applied in the service, not per caller"). The key here names
 * the NOTE, not the thread, so two separate notes that both mention you are two
 * notifications — being mentioned twice is two events.
 */
"use strict";

const notify = require("../../notification/notification.service");
const chat = require("../../smartcomm/smartcomm.service");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * Resolve the mentioned user, refusing an employee with no account.
 *
 * §7.4 is explicit that a silent no-op mention is worse than none: the person
 * typing believes they have reached a colleague. So this throws rather than
 * skipping, and the message says why.
 */
async function resolveMentionable(client, userId) {
  const { rows } = await client.query(
    `SELECT user_id, full_name FROM app_user WHERE user_id = $1 AND status = 'ACTIVE'`,
    [userId],
  );
  if (!rows[0]) {
    throw new AppError(
      "NO_USER_ACCOUNT",
      "That employee has no user account, so they cannot be mentioned.",
      422,
    );
  }
  return rows[0];
}

/** «Re: BL for SLAS-2026-0042» — 'can we hold the demurrage?' */
function cardText({ authorName, subject, excerpt }) {
  const who = authorName || "Someone";
  const where = subject ? `«${subject}»` : "a mail thread";
  const what = excerpt ? ` — “${excerpt}”` : "";
  return `${who} mentioned you on ${where}${what}`;
}

/**
 * Post the compact card into the author↔mentioned direct channel.
 *
 * Best-effort by design: chat is the third of three channels and the mention
 * row plus the in-app notification have already landed. A tenant that has never
 * opened Smart Comms should not lose mentions because of it.
 */
async function postCard(client, { author, target, text, threadId }) {
  try {
    const channel = await chat.createChannel(client, {
      data: { kind: "DIRECT", member_ids: [target.user_id], name: null },
      actor: { user_id: author.user_id },
    });
    if (!channel) return null;
    return await chat.postMessage(client, {
      groupId: channel.group_id,
      body: `${text}\n/comms/mail?thread=${threadId}&tab=notes`,
      actor: { user_id: author.user_id },
      notifyMembers: false,
    });
  } catch (err) {
    logger.warn({ err, thread: threadId }, "[mail] mention chat card not posted");
    return null;
  }
}

/**
 * Fan one mention out across all three channels.
 *
 * @returns {{ userId, inApp: boolean, chat: boolean }}
 */
async function fanOut(client, {
  noteId, threadId, subject = null, excerpt = null,
  author = {}, target,
}) {
  const text = cardText({ authorName: author.full_name, subject, excerpt });

  // (1) in-app, and (3) push, which notify() delivers off the same decision.
  const inApp = await notify.notify(client, {
    userId: target.user_id,
    eventTypeKey: "mention.created",
    title: "You were mentioned on a mail thread",
    body: text,
    entityRef: `email_thread:${threadId}`,
    category: "MENTION",
    // The NOTE, not the thread: two notes that mention you are two events.
    dedupeKey: `MENTION:email_thread_note:${noteId}:${target.user_id}`,
  });

  // (2) chat.
  const card = await postCard(client, { author, target, text, threadId });

  return { userId: target.user_id, inApp: Boolean(inApp), chat: Boolean(card) };
}

module.exports = { fanOut, resolveMentionable, cardText, postCard };
