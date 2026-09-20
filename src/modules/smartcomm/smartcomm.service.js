/**
 * Smart Comms (MOD-64) — corporate WhatsApp-style messaging (PRD §11.5): channels
 * (department/project/dossier/direct/client) with members, presence, read
 * receipts, reactions, stars, drafts, quick replies, search, and a tamper-evident
 * CERTIFIED EXPORT (SHA-256 transcript → vault, verifiable via MOD-66). No social
 * APIs — phone/email are wa.me/tel:/mailto links on the client. Membership is the
 * authorization boundary: you can only read/post in a channel you belong to. All
 * SQL is in the repo.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./smartcomm.repo");
const scheduled = require("./smartcomm.schedule.repo");
const media = require("./smartcomm.media.service");
const erp = require("./smartcomm.erp.service");
// The call record half (PR-2). Required at the top for the card resolution
// below; the pipeline requires THIS file lazily inside sendSummary, which is
// what keeps the pair from being a load-time cycle.
const pipeline = require("./smartcomm.call.pipeline.service");
const links = require("./smartcomm.links.service");
const events = require("./smartcomm.events");
const documents = require("../../services/documents/document.service");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const realtime = require("../../realtime");
const requestContext = require("../../config/request-context");

const gref = (id) => "comms_group:" + id;

/** Push a live event to a channel's subscribers (best-effort; no-op if the
 *  socket server isn't running). Scoped to the ambient request's tenant. */
function rtPublish(groupId, event, payload) {
  const slug = requestContext.getTenant();
  if (slug) realtime.publish(slug, groupId, event, payload);
}

async function assertMember(client, groupId, userId) {
  const m = await repo.findMember(client, groupId, userId);
  if (!m) throw new AppError("NOT_A_MEMBER", "You are not a member of this channel", 403);
  return m;
}

// ── Channels ──
const listChannels = (client, actor, q) => repo.listChannelsForUser(client, actor.user_id, q);
async function getChannel(client, { id, actor }) {
  await assertMember(client, id, actor.user_id);
  await repo.touchPresence(client, id, actor.user_id);
  return repo.getChannelEnriched(client, id);
}
async function createChannel(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    // Direct-channel dedupe: reuse an existing DM instead of making duplicates.
    if (data.kind === "DIRECT" && Array.isArray(data.member_ids) && data.member_ids.length === 1) {
      const existing = await repo.findDirectChannel(client, actor.user_id, data.member_ids[0]);
      if (existing) { await client.query("COMMIT"); return existing; }
    }
    const g = await repo.insertChannel(client, { name: data.name, kind: data.kind || "DIRECT", dossier_id: data.dossier_id || null, client_id: data.client_id || null, topic: data.topic || null, created_by: await resolveActorId(client, actor.user_id) });
    await repo.addMember(client, { groupId: g.group_id, userId: actor.user_id, memberRole: "OWNER" });
    for (const uid of data.member_ids || []) {
      if (uid === actor.user_id) continue;
      /// eslint-disable-next-line no-await-in-loop
      await repo.addMember(client, { groupId: g.group_id, userId: uid, memberRole: "MEMBER" });
    }
    await emitEvent(client, { eventTypeKey: events.GROUP_CREATED, moduleKey: events.MODULE, entityRef: gref(g.group_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.GROUP_CREATED, moduleKey: events.MODULE, entityRef: gref(g.group_id), after: g });
    await client.query("COMMIT");
    return g;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function setArchived(client, { id, archived, actor }) {
  await assertMember(client, id, actor.user_id);
  return repo.updateChannel(client, id, { status: archived ? "ARCHIVED" : "ACTIVE" });
}

// ── Members ──
async function addMember(client, { groupId, userId, memberRole, actor }) {
  await assertMember(client, groupId, actor.user_id);
  return repo.addMember(client, { groupId, userId, memberRole });
}
async function removeMember(client, { groupId, userId, actor }) {
  await assertMember(client, groupId, actor.user_id);
  return { removed: await repo.removeMember(client, groupId, userId) };
}
/**
 * API F-22: this had no membership assert, so `GET /channels/:id/members`
 * disclosed the roster of ANY channel to anyone holding MOD-64 `view` — who is
 * in a private conversation is itself the sensitive part.
 */
async function listMembers(client, { groupId, actor }) {
  await assertMember(client, groupId, actor.user_id);
  return repo.listMembers(client, groupId);
}
async function setPinned(client, { groupId, actor, pinned }) { await assertMember(client, groupId, actor.user_id); return repo.setMemberFlag(client, groupId, actor.user_id, "is_pinned", pinned === true); }
async function setMuted(client, { groupId, actor, muted }) { await assertMember(client, groupId, actor.user_id); return repo.setMemberFlag(client, groupId, actor.user_id, "is_muted", muted === true); }

// ── Messages ──
/**
 * One posted attachment → one `comms_attachment` row.
 *
 * Three kinds now share the table, and the kind decides which column carries
 * the pointer. It is normalised HERE rather than trusted from the request
 * because the client sends back exactly what `store()` handed it, and a body
 * that claimed `attachment_kind: "ERP"` while carrying a `vault_id` would
 * otherwise produce a row that renders as a record card pointing at a file.
 *
 * A descriptor whose kind is unrecognised falls back to VAULT, which is what
 * every row written before migration 13794 is.
 */
function attachmentRow(messageId, a) {
  const kind = a && a.attachment_kind;
  const base = {
    message_id: messageId,
    filename: (a && a.filename) || null,
    content_type: (a && a.content_type) || null,
    size_bytes: (a && a.size_bytes) || null,
  };
  if (kind === "MEDIA") {
    return { ...base, attachment_kind: "MEDIA", media_id: a.media_id || null };
  }
  if (kind === "CALL") {
    // A call summary card (PR-2). The card RESOLVES at read time, exactly like
    // an ERP reference: the summary can be regenerated in the other language,
    // and a reader must see the current draft, not the bytes that were frozen
    // into the message. The message itself carries only the pointer.
    return {
      ...base,
      attachment_kind: "CALL",
      call_id: (a && a.call_id) || null,
    };
  }
  if (kind === "ERP") {
    return {
      ...base,
      attachment_kind: "ERP",
      erp_kind: a.erp_kind || null,
      erp_id: a.erp_id || null,
      // The sender's view of the reference, cached ONLY as the fallback
      // caption for a reader without rights on the record. Never a figure —
      // see smartcomm.erp.service.js.
      erp_label: a.erp_label ? String(a.erp_label).slice(0, 120) : null,
    };
  }
  return { ...base, attachment_kind: "VAULT", vault_id: (a && a.vault_id) || null };
}

/** What the notification says when the message is attachments and no words. */
function attachmentSummary(attachments) {
  const list = attachments || [];
  if (!list.length) return "Sent an attachment";
  if (list.some((a) => a && a.is_voice_note)) return "Sent a voice note";
  if (list.some((a) => a && a.attachment_kind === "ERP")) return "Shared a record";
  if (list.some((a) => a && a.attachment_kind === "CALL")) return "Shared a call summary";
  const first = list[0] || {};
  if (first.kind === "IMAGE") return list.length > 1 ? `Sent ${list.length} photos` : "Sent a photo";
  if (first.kind === "VIDEO") return "Sent a video";
  return list.length > 1 ? `Sent ${list.length} files` : "Sent a file";
}

/**
 * `notifyMembers: false` posts the message without raising its own notification.
 *
 * For callers that have ALREADY notified the same people about the same logical
 * event — the mail mention fan-out is the first (§7.4, addition f: "one logical
 * event produces at most one notification per user per channel"). Without it,
 * being mentioned on a mail thread arrives twice: once as the mention, once as
 * "new message in Smart Comms". The chat card is still posted and still shows
 * up in the channel; only the duplicate notification is skipped.
 */
async function postMessage(client, { groupId, body = null, mediaVaultId = null, replyTo = null, attachments = [], actor = {}, notifyMembers = true, scheduleId = null, tenantMeta = null, env = "live" }) {
  await client.query("BEGIN");
  try {
    if (scheduleId) {
      const queued = await scheduled.claim(client, scheduleId);
      if (!queued) { await client.query("COMMIT"); return null; }
      groupId = queued.group_id;
      actor = await scheduled.sender(client, queued.sender_user_id, groupId);
      if (!actor) throw new AppError("NOT_A_MEMBER", "Sender no longer has permission to send", 403);
      body = queued.body; attachments = queued.attachments; replyTo = queued.reply_to;
      await require("./smartcomm.schedule.service").validateAttachments(client, groupId, attachments, replyTo);
    }
    await assertMember(client, groupId, actor.user_id);
    if (!body && !mediaVaultId && (!attachments || !attachments.length)) throw new AppError("EMPTY_MESSAGE", "a message needs a body or media", 422);
    const m = await repo.insertMessage(client, { group_id: groupId, sender_user_id: actor.user_id || null, body, media_vault_id: mediaVaultId, reply_to_message_id: replyTo });
    for (const a of attachments || []) {
      /// eslint-disable-next-line no-await-in-loop
      await repo.addAttachment(client, attachmentRow(m.message_id, a));
    }
    await repo.updateChannel(client, groupId, {}); // bump updated_at
    await emitEvent(client, { eventTypeKey: events.MESSAGE_POSTED, moduleKey: events.MODULE, entityRef: "comms_message:" + m.message_id, actorUserId: actor.user_id || null });
    if (scheduleId) await scheduled.sent(client, scheduleId, m.message_id);
    await client.query("COMMIT");
    // The preview rows for a message a person just sent, written OUTSIDE the
    // transaction on purpose. A link preview is bookkeeping about somebody
    // else's web page: it must never be able to fail a send, hold the message's
    // row locks while a third party is slow, or — worst — make a message
    // undeliverable because a tenant's Redis is down. Everything here is wrapped,
    // and the only consequence of any of it failing is that the card shows up on
    // the first read instead of before it.
    try {
      await links.recordSentLinks(client, { body, m, tenantMeta, env });
    } catch {
      /* @silent:storage|parse|teardown */
    }
    rtPublish(groupId, "comms:message", { group_id: groupId, message: m });
    // G22 — a posted message notifies the OTHER members through the same
    // preference-honouring channel every other module uses (IN_APP + optional
    // EMAIL/PUSH per user preference). Best-effort and AFTER commit: a notify
    // failure must never fail the message itself. The sender is excluded — you
    // already know you wrote it.
    try {
      const others = notifyMembers ? await repo.memberUserIds(client, groupId, actor.user_id || null) : [];
      if (others.length) {
        // `../notification/…`, NOT `../../`. This file sits at
        // src/modules/smartcomm/ — one level shallower than every OTHER
        // notification caller (src/modules/<area>/<sub>/), which is where the
        // `../../` was copied from. From here it resolved to
        // src/notification/notification.service, a directory that has never
        // existed, so this line threw MODULE_NOT_FOUND into the best-effort
        // catch below and Smart Comms notified NOBODY — no in-app row, no
        // push, no email — silently, for every message ever posted.
        //
        // The catch is right to be there (a notify failure must not fail the
        // message) and is exactly what hid this: a require error and a push
        // service being briefly unreachable are indistinguishable to it.
        await require("../notification/notification.service").notifyMany(client, others, {
          eventTypeKey: "comms.message_posted",
          // The SENDER is the headline and the message is the body — the shape
          // every messaging app uses, and the one that reads correctly on a
          // lock screen. It used to put the message text in BOTH, so a
          // notification showed the same sentence twice and never said who
          // wrote it.
          // `req.user` carries `display_name`, not `full_name` (middleware/auth.js).
          // Falling back to the message text keeps this no worse than what it
          // replaced for a caller that passes neither — a system-posted card,
          // say, which has no human sender to name.
          title: String(
            (actor && (actor.display_name || actor.email))
            || body
            || "New message in Smart Comms",
          ).slice(0, 90),
          // A lock screen that says "Sent an attachment" for a voice note tells
          // the reader nothing about whether to pick up the phone. Naming the
          // format costs nothing and is the difference between acting now and
          // opening the app to find out.
          body: body ? String(body).slice(0, 500) : attachmentSummary(attachments),
          entityRef: "comms_message:" + m.message_id,
          category: "comms",
          // Straight into the channel the message was posted in. `?channel=`
          // is the param the chat page already reads (features/comms/team-chat.tsx),
          // so no client change is needed to make this land.
          url: `/comms?channel=${groupId}`,
          // Collapse per CHANNEL: a fast back-and-forth in one channel becomes
          // one notification showing the latest message, while a message in a
          // different channel stays its own. `renotify` keeps the replacement
          // audible rather than silently swapping the text.
          pushTag: `comms:${groupId}`,
          renotify: true,
          // Somebody in the company is talking to this person right now.
          urgency: "high",
          // Same reliability promise mail has made since it was written: a
          // notification that reaches NO device must reach the person some
          // other way. Chat was the one conversational channel without it, so
          // a colleague messaging someone with no registered device produced
          // an in-app row they would see whenever they next happened to open
          // the app — which, for the channel people use when they need an
          // answer now, is indistinguishable from not being told.
          //
          // It is not an email per message. `deliverOutbound` sends it only
          // when push reached ZERO devices, and two carve-outs there already
          // hold: nothing is sent to someone who SILENCED this category (that
          // would route around an opt-out they made on purpose), and nothing
          // is sent when the deploy has no VAPID keypair at all (an operations
          // problem an email per notification would bury while flooding every
          // inbox).
          //
          // What it does not bound is VOLUME for a recipient who has push
          // available and has simply never opted a device in: `pushTag`
          // collapses a fast exchange into one BANNER, but the email leg has
          // no equivalent, so twenty messages in one channel are twenty
          // emails. Mail lives with the same shape and its volume is bounded
          // by real mail arriving; chat's is not. If that bites, the fix is a
          // per-(user, channel) cooldown on the fallback leg rather than
          // removing it — see the note on this in doc/PUSH_NOTIFICATIONS.md.
          emailFallback: true,
          pushData: { kind: "comms", group_id: groupId, message_id: m.message_id },
        });
      }
    } catch {
      /* @silent:storage|parse|teardown */
      /* notify is best-effort — never mask the message that succeeded */
    }
    return m;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * G22 — acknowledge a message (the legacy's read-receipt-on-a-directive).
 * Only a channel member may acknowledge; idempotent per user (the first stamp
 * sticks). The sender can see who acknowledged via the message row's
 * acknowledged_by/acknowledged_at columns.
 */
async function acknowledge(client, { messageId, actor }) {
  const m = await repo.getMessage(client, messageId);
  if (!m) throw new AppError("NOT_FOUND", "Message not found", 404);
  await assertMember(client, m.group_id, actor.user_id);
  const row = await repo.acknowledgeMessage(client, messageId, actor.user_id);
  return { acknowledged: true, message_id: messageId, acknowledged_by: row.acknowledged_by, acknowledged_at: row.acknowledged_at };
}
async function editMessage(client, { messageId, body, actor }) {
  const m = await repo.getMessage(client, messageId);
  if (!m) throw new AppError("NOT_FOUND", "Message not found", 404);
  if (m.sender_user_id !== actor.user_id) throw new AppError("NOT_YOURS", "You can only edit your own message", 403);
  await assertMember(client, m.group_id, actor.user_id);
  if (m.deleted_at) throw new AppError("NOT_FOUND", "Message was deleted", 404);
  const updated = await repo.editMessage(client, messageId, body);
  if (!updated) throw new AppError("NOT_FOUND", "Message was deleted", 404);
  rtPublish(m.group_id, "comms:message_edited", { group_id: m.group_id, message: updated });
  return updated;
}
async function deleteMessage(client, { messageId, actor }) {
  const m = await repo.getMessage(client, messageId);
  if (!m) throw new AppError("NOT_FOUND", "Message not found", 404);
  if (m.sender_user_id !== actor.user_id) throw new AppError("NOT_YOURS", "You can only delete your own message", 403);
  const deleted = Boolean(await repo.softDeleteMessage(client, messageId));
  if (deleted) rtPublish(m.group_id, "comms:message_deleted", { group_id: m.group_id, message_id: messageId });
  return { deleted };
}
/**
 * A page of messages, with everything the bubble needs to render attached.
 *
 * `erpAllow` is the set of module keys THIS READER holds `view` on, resolved
 * per-request by the controller. It is threaded down here rather than looked up
 * in the service because permissions live on the request, and because passing
 * it explicitly makes it impossible to forget: an ERP card resolved without it
 * is a card with `redacted: true`, which fails safe.
 *
 * Three fan-out queries for the whole page, not three per message. Fifty
 * bubbles used to be one query because a bubble was a line of text; the cost of
 * making them rich is paid once per page, not once per bubble.
 */
async function thread(client, { groupId, actor, limit, before, erpAllow = new Set(), tenantMeta = null, env = "live" }) {
  await assertMember(client, groupId, actor.user_id);
  await repo.touchPresence(client, groupId, actor.user_id);
  // `before` is a query-string value and can arrive as an array (`?before=x&
  // before=y`), which node-postgres would serialise as a Postgres array literal
  // against a timestamptz comparison — a 500 rather than a page of messages.
  // The first value is the right reading here: a cursor has one position.
  const cursor = Array.isArray(before) ? before[0] : before;
  const messages = await repo.listMessages(client, groupId, { limit: Number(limit) || 50, before: cursor || null });
  const ids = messages.map((m) => m.message_id);

  const [attachments, reactions, starred] = await Promise.all([
    repo.listAttachmentsForMessages(client, ids),
    repo.listReactionsForMessages(client, ids),
    repo.listStarsForMessages(client, ids, actor.user_id),
  ]);

  // Resolve every ERP reference on the page against the reader, once per
  // distinct record rather than once per bubble — the same invoice quoted
  // three times in a conversation is one lookup.
  const erpRefs = attachments.filter((a) => a.attachment_kind === "ERP" && a.erp_id);
  const seen = new Map();
  for (const r of erpRefs) {
    const key = `${r.erp_kind}:${r.erp_id}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  const cards = await erp.resolveMany(client, [...seen.values()], erpAllow);
  const cardByKey = new Map([...seen.keys()].map((k, i) => [k, cards[i]]));

  // Call summary cards (PR-2), resolved the same way and for the same reason:
  // one lookup per distinct CALL on the page, and the card the reader sees is
  // the CURRENT draft/record rather than what was frozen into the message —
  // a summary can be regenerated in the other language after it was posted, and
  // a reader must see the same thing the transcript link will show them.
  const callIds = attachments.filter((a) => a.attachment_kind === "CALL" && a.call_id).map((a) => a.call_id);
  const callCards = await pipeline.cardsForCallIds(client, callIds);

  const starSet = new Set(starred);
  const byMessage = new Map(ids.map((id) => [id, { attachments: [], reactions: [] }]));
  for (const a of attachments) {
    const bucket = byMessage.get(a.message_id);
    if (!bucket) continue;
    bucket.attachments.push(
      a.attachment_kind === "ERP"
        ? { ...a, erp_card: cardByKey.get(`${a.erp_kind}:${a.erp_id}`) || null }
        : a.attachment_kind === "CALL"
          ? { ...a, call_card: callCards.get(a.call_id) || null }
          : a,
    );
  }
  for (const r of reactions) {
    const bucket = byMessage.get(r.message_id);
    if (bucket) bucket.reactions.push({ emoji: r.emoji, count: r.count, users: r.users });
  }

  // Link previews, resolved for THIS page, after the messages are in hand.
  //
  // A separate call rather than a JOIN, and never a fetch: a thread read is the
  // hot path of the most-used screen in the product, and a card is worth at most
  // one indexed lookup per distinct URL. Where a URL has no row yet — a message
  // older than this feature, a link pasted by a producer that never queued a
  // fetch — `previewsFor` creates the row and enqueues the work, so the reader
  // sees nothing and the NEXT reader sees a card. A slow third-party site is
  // therefore never able to make opening a chat slow, which is the property the
  // split exists to buy.
  const previews = await links.previewsFor(client, messages, { tenantMeta, env });

  return {
    group_id: groupId,
    messages: messages.map((m) => ({
      ...m,
      attachments: byMessage.get(m.message_id)?.attachments || [],
      reactions: byMessage.get(m.message_id)?.reactions || [],
      starred_by_me: starSet.has(m.message_id),
      // The URLs in this bubble, in reading order. The CARD is not here: it lives
      // once in `links.by_url`, because a link quoted nine times in one thread is
      // nine references to one preview and not nine copies of a description.
      link_urls: previews.byMessage[m.message_id] || [],
    })),
    links: previews.byUrl,
  };
}

// ── Reactions / stars / search ──

/**
 * Membership check for an operation addressed by MESSAGE id rather than channel
 * id (API F-22).
 *
 * `react` and `star` took a bare `messageId` and never checked anything, so any
 * user holding MOD-64 `view` could react to or star ANY message in ANY channel
 * — including channels they are not a member of and cannot otherwise see. A
 * reaction is broadcast over the realtime channel, so it was also a way to
 * announce your presence in a private conversation.
 *
 * Resolving the message to its channel first is what makes the existing
 * `assertMember` reachable from these two.
 *
 * Returns the message, since both callers need it anyway.
 */
async function assertMessageMember(client, messageId, userId) {
  const msg = await repo.getMessage(client, messageId);
  // Same error as a non-member on a channel: not disclosing whether the message
  // id exists is the point.
  if (!msg) throw new AppError("NOT_A_MEMBER", "You are not a member of this channel", 403);
  await assertMember(client, msg.group_id, userId);
  return msg;
}

async function react(client, { messageId, emoji, actor }) {
  const msg = await assertMessageMember(client, messageId, actor.user_id);
  const r = await repo.toggleReaction(client, { messageId, userId: actor.user_id, emoji });
  const reactions = await repo.listReactions(client, messageId);
  rtPublish(msg.group_id, "comms:reaction", { group_id: msg.group_id, message_id: messageId, reactions });
  return { ...r, reactions };
}

async function star(client, { messageId, actor }) {
  await assertMessageMember(client, messageId, actor.user_id);
  return repo.toggleStar(client, { messageId, userId: actor.user_id });
}
const starred = (client, actor) => repo.listStarredForUser(client, actor.user_id);
/**
 * Cross-channel message search.
 *
 * `term` is coerced to a string before anything reads its length, because
 * `?q=a&q=b` hands Express an ARRAY. `["a","b"].length` is 2, which sails past
 * a `< 2` guard meant to reject one-character searches, and the value then
 * string-concatenates into the ILIKE pattern as "a,b" — so the guard measured
 * the number of parameters while the query searched for something the user
 * never typed. CodeQL calls this type confusion through parameter tampering.
 *
 * Joining rather than taking the first is deliberate: somebody who sent two
 * values meant both, and a search for "a,b" finding nothing is a truthful
 * answer where silently searching for "a" is not.
 */
async function search(client, { actor, term }) {
  const q = (Array.isArray(term) ? term.join(",") : String(term ?? "")).trim();
  if (q.length < 2) throw new AppError("BAD_SEARCH", "search term too short", 422);
  return repo.searchMessages(client, actor.user_id, q);
}

// ── Reads / presence ──
async function markRead(client, { groupId, actor }) { await assertMember(client, groupId, actor.user_id); await repo.markChannelRead(client, groupId, actor.user_id); rtPublish(groupId, "comms:read", { group_id: groupId, user_id: actor.user_id }); return { ok: true }; }
const unread = (client, actor) => repo.unreadCountForUser(client, actor.user_id);

// ── Drafts ──
const getDraft = (client, { groupId, actor }) => repo.getDraft(client, groupId, actor.user_id);
const saveDraft = (client, { groupId, body, actor }) => repo.upsertDraft(client, { groupId, userId: actor.user_id, body });
async function clearDraft(client, { groupId, actor }) { await repo.deleteDraft(client, groupId, actor.user_id); return { ok: true }; }

// ── Quick replies ──
const listQuickReplies = (client, actor) => repo.listQuickReplies(client, actor.user_id);
const createQuickReply = (client, { data, actor }) => repo.createQuickReply(client, { owner_user_id: actor.user_id, label: data.label, body: data.body });
async function updateQuickReply(client, { id, patch, actor }) {
  const row = await repo.updateQuickReply(client, id, patch, actor.user_id);
  if (!row) throw new AppError("NOT_FOUND", "Quick phrase not found", 404);
  return row;
}
async function deleteQuickReply(client, { id, actor }) {
  const row = await repo.deleteQuickReply(client, id, actor.user_id);
  if (!row) throw new AppError("NOT_FOUND", "Quick phrase not found", 404);
  return { deleted: true };
}

// ── Media + ERP references ──
/**
 * Upload one file into a channel and hand back an attachment descriptor.
 *
 * Membership is asserted HERE and not in the media service, so the media
 * service stays a store rather than a second place authorisation is decided —
 * `assertMember` is passed down to the reads that need it for the same reason.
 *
 * The message is NOT posted by this call. The composer uploads while the person
 * is still typing and posts one message carrying the descriptors afterwards,
 * which is what lets a picture appear in the bubble the instant it is sent
 * rather than a beat later.
 */
async function uploadMedia(client, { groupId, file, isVoiceNote, durationMs, waveform, width, height, slug, actor }) {
  await assertMember(client, groupId, actor.user_id);
  return media.store(client, { groupId, file, isVoiceNote, durationMs, waveform, width, height, slug, actor });
}

/**
 * Transcribe a voice note because a member asked, and tell the channel.
 *
 * Reader-initiated, not upload-initiated — see the long note in
 * `smartcomm.media.service.js` for why the provider is no longer called for
 * every clip anybody records.
 *
 * The realtime publish stays, and now earns more than it did: one person
 * pressing Transcribe puts the words under the bubble for everyone else who
 * has the thread open, so the second and third member of a channel do not each
 * pay for the same clip to learn the same sentence.
 *
 * `groupId` comes off the media row rather than the URL: the caller addresses a
 * media id, and taking the channel from anywhere but the row it belongs to
 * would let a member of channel A publish into channel B.
 */
async function transcribeVoiceNote(client, { mediaId, language, actor }) {
  const row = await media.transcribeVoiceNote(client, { mediaId, language, assertMember, actor });
  if (row) {
    rtPublish(row.group_id, "comms:transcript", {
      group_id: row.group_id,
      media_id: mediaId,
      transcript: row.transcript,
      transcript_status: row.transcript_status,
    });
  }
  return {
    media_id: mediaId,
    transcript: (row && row.transcript) || null,
    transcript_status: (row && row.transcript_status) || "FAILED",
  };
}

const mediaBytes = (client, { mediaId, actor }) => media.bytes(client, { mediaId, assertMember, actor });
const promoteMedia = (client, { mediaId, actor, slug, docType, entityRef }) =>
  media.promote(client, { mediaId, assertMember, actor, slug, docType, entityRef });

const erpSearch = (client, { term, allow, kinds, limit }) => erp.search(client, { term, allow, kinds, limit });
const erpCard = (client, { kind, id, allow }) => erp.resolve(client, { kind, id, allow });

// ── Directory + certified export ──
const colleagues = (client, q) => repo.listColleagues(client, q);
async function certifiedExport(client, { groupId, actor = {} }) {
  await assertMember(client, groupId, actor.user_id);
  const messages = await repo.listMessages(client, groupId, { limit: 200 });
  // A voice note used to render as "(media)" here — so the one format people
  // reach for when an instruction is urgent was the one format that vanished
  // from the certified record of the channel. Where a transcript exists it IS
  // the line, marked as spoken so nobody later mistakes it for something that
  // was typed.
  const spoken = new Map(
    (await repo.voiceTranscriptsForGroup(client, groupId)).map((r) => [r.message_id, r.transcript]),
  );
  const lineFor = (m) => {
    if (m.deleted_at) return "(deleted)";
    if (m.body) return m.body;
    const said = spoken.get(m.message_id);
    return said ? `(voice note) ${said}` : "(media)";
  };
  const transcript = messages.map((m) => `[${m.created_at}] ${m.sender_user_id || "system"}: ${lineFor(m)}`).join("\n");
  const contentHash = crypto.createHash("sha256").update(transcript).digest("hex");
  const doc = await documents.capture(client, { entityRef: gref(groupId), docType: "COMMS_CERTIFIED_EXPORT", contentHash, status: "VERIFIED" });
  await emitEvent(client, { eventTypeKey: events.EXPORTED, moduleKey: events.MODULE, entityRef: gref(groupId), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.EXPORTED, moduleKey: events.MODULE, entityRef: gref(groupId), after: { content_hash: contentHash, messages: messages.length } });
  return { group_id: groupId, message_count: messages.length, content_hash: contentHash, doc_id: doc ? doc.doc_id : null };
}

// The reconciliation statement (MOD-76/Q19) posts into the file's own thread.
const findDossierChannel = (client, { dossierId }) => repo.findDossierChannel(client, dossierId);

module.exports = {
  listChannels, getChannel, createChannel, setArchived, findDossierChannel,
  addMember, removeMember, listMembers, setPinned, setMuted,
  postMessage, editMessage, deleteMessage, thread,
  react, star, starred, search, markRead, unread,
  getDraft, saveDraft, clearDraft,
  listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
  colleagues, certifiedExport, acknowledge,
  uploadMedia, mediaBytes, promoteMedia, transcribeVoiceNote,
  erpSearch, erpCard,
};
