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
const events = require("./smartcomm.events");
const documents = require("../../services/documents/document.service");
const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const gref = (id) => "comms_group:" + id;

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
    const g = await repo.insertChannel(client, { name: data.name, kind: data.kind || "DIRECT", dossier_id: data.dossier_id || null, client_id: data.client_id || null, topic: data.topic || null, created_by: actor.user_id || null });
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
const listMembers = (client, { groupId }) => repo.listMembers(client, groupId);
async function setPinned(client, { groupId, actor, pinned }) { await assertMember(client, groupId, actor.user_id); return repo.setMemberFlag(client, groupId, actor.user_id, "is_pinned", pinned === true); }
async function setMuted(client, { groupId, actor, muted }) { await assertMember(client, groupId, actor.user_id); return repo.setMemberFlag(client, groupId, actor.user_id, "is_muted", muted === true); }

// ── Messages ──
async function postMessage(client, { groupId, body = null, mediaVaultId = null, replyTo = null, attachments = [], actor = {} }) {
  await assertMember(client, groupId, actor.user_id);
  if (!body && !mediaVaultId && (!attachments || !attachments.length)) throw new AppError("EMPTY_MESSAGE", "a message needs a body or media", 422);
  await client.query("BEGIN");
  try {
    const m = await repo.insertMessage(client, { group_id: groupId, sender_user_id: actor.user_id || null, body, media_vault_id: mediaVaultId, reply_to_message_id: replyTo });
    for (const a of attachments || []) {
      /// eslint-disable-next-line no-await-in-loop
      await repo.addAttachment(client, { message_id: m.message_id, vault_id: a.vault_id || null, filename: a.filename || null, content_type: a.content_type || null, size_bytes: a.size_bytes || null });
    }
    await repo.updateChannel(client, groupId, {}); // bump updated_at
    await emitEvent(client, { eventTypeKey: events.MESSAGE_POSTED, moduleKey: events.MODULE, entityRef: "comms_message:" + m.message_id, actorUserId: actor.user_id || null });
    await client.query("COMMIT");
    return m;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function editMessage(client, { messageId, body, actor }) {
  const m = await repo.getMessage(client, messageId);
  if (!m) throw new AppError("NOT_FOUND", "Message not found", 404);
  if (m.sender_user_id !== actor.user_id) throw new AppError("NOT_YOURS", "You can only edit your own message", 403);
  return repo.editMessage(client, messageId, body);
}
async function deleteMessage(client, { messageId, actor }) {
  const m = await repo.getMessage(client, messageId);
  if (!m) throw new AppError("NOT_FOUND", "Message not found", 404);
  if (m.sender_user_id !== actor.user_id) throw new AppError("NOT_YOURS", "You can only delete your own message", 403);
  return { deleted: Boolean(await repo.softDeleteMessage(client, messageId)) };
}
async function thread(client, { groupId, actor, limit, before }) {
  await assertMember(client, groupId, actor.user_id);
  await repo.touchPresence(client, groupId, actor.user_id);
  const messages = await repo.listMessages(client, groupId, { limit: Number(limit) || 50, before });
  return { group_id: groupId, messages };
}

// ── Reactions / stars / search ──
async function react(client, { messageId, emoji, actor }) { const r = await repo.toggleReaction(client, { messageId, userId: actor.user_id, emoji }); return { ...r, reactions: await repo.listReactions(client, messageId) }; }
async function star(client, { messageId, actor }) { return repo.toggleStar(client, { messageId, userId: actor.user_id }); }
const starred = (client, actor) => repo.listStarredForUser(client, actor.user_id);
async function search(client, { actor, term }) { if (!term || term.length < 2) throw new AppError("BAD_SEARCH", "search term too short", 422); return repo.searchMessages(client, actor.user_id, term); }

// ── Reads / presence ──
async function markRead(client, { groupId, actor }) { await assertMember(client, groupId, actor.user_id); await repo.markChannelRead(client, groupId, actor.user_id); return { ok: true }; }
const unread = (client, actor) => repo.unreadCountForUser(client, actor.user_id);

// ── Drafts ──
const getDraft = (client, { groupId, actor }) => repo.getDraft(client, groupId, actor.user_id);
const saveDraft = (client, { groupId, body, actor }) => repo.upsertDraft(client, { groupId, userId: actor.user_id, body });
async function clearDraft(client, { groupId, actor }) { await repo.deleteDraft(client, groupId, actor.user_id); return { ok: true }; }

// ── Quick replies ──
const listQuickReplies = (client, actor) => repo.listQuickReplies(client, actor.user_id);
const createQuickReply = (client, { data, actor }) => repo.createQuickReply(client, { owner_user_id: data.shared ? null : actor.user_id, label: data.label, body: data.body });
const updateQuickReply = (client, { id, patch }) => repo.updateQuickReply(client, id, { ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.body !== undefined ? { body: patch.body } : {}) });
async function deleteQuickReply(client, { id }) { await repo.deleteQuickReply(client, id); return { deleted: true }; }

// ── Directory + certified export ──
const colleagues = (client, q) => repo.listColleagues(client, q);
async function certifiedExport(client, { groupId, actor = {} }) {
  await assertMember(client, groupId, actor.user_id);
  const messages = await repo.listMessages(client, groupId, { limit: 200 });
  const transcript = messages.map((m) => `[${m.created_at}] ${m.sender_user_id || "system"}: ${m.deleted_at ? "(deleted)" : (m.body || "(media)")}`).join("\n");
  const contentHash = crypto.createHash("sha256").update(transcript).digest("hex");
  const doc = await documents.capture(client, { entityRef: gref(groupId), docType: "COMMS_CERTIFIED_EXPORT", contentHash, status: "VERIFIED" });
  await emitEvent(client, { eventTypeKey: events.EXPORTED, moduleKey: events.MODULE, entityRef: gref(groupId), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.EXPORTED, moduleKey: events.MODULE, entityRef: gref(groupId), after: { content_hash: contentHash, messages: messages.length } });
  return { group_id: groupId, message_count: messages.length, content_hash: contentHash, doc_id: doc ? doc.doc_id : null };
}

module.exports = {
  listChannels, getChannel, createChannel, setArchived,
  addMember, removeMember, listMembers, setPinned, setMuted,
  postMessage, editMessage, deleteMessage, thread,
  react, star, starred, search, markRead, unread,
  getDraft, saveDraft, clearDraft,
  listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
  colleagues, certifiedExport,
};
