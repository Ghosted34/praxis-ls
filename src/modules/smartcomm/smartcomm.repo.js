/**
 * Smart Comms repository (MOD-64). All SQL for channels, members, messages,
 * reactions, stars, reads, attachments, drafts and quick replies. Corporate
 * WhatsApp-style; no external social routing (PRD §11.5).
 */
"use strict";
const { insertOne, getById, page } = require("../../shared/db/query-helpers");

// ── Channels (comms_group) ──
const insertChannel = (client, data) => insertOne(client, "comms_group", data);
const getChannel = (client, id) => getById(client, "comms_group", "group_id", id);

async function listChannelsForUser(client, userId, q = {}) {
  const { limit, offset } = page(q);
  const { rows } = await client.query(
    "SELECT g.*, m.is_pinned, m.is_muted, m.last_read_at, " +
      "  (SELECT COUNT(*)::int FROM comms_message x WHERE x.group_id = g.group_id AND x.deleted_at IS NULL " +
      "     AND (m.last_read_at IS NULL OR x.created_at > m.last_read_at) AND x.sender_user_id <> $1) AS unread " +
      "FROM comms_group g JOIN comms_member m ON m.group_id = g.group_id AND m.user_id = $1 " +
      "WHERE g.status = 'ACTIVE' ORDER BY m.is_pinned DESC, g.updated_at DESC LIMIT $2 OFFSET $3",
    [userId, limit, offset],
  );
  return rows;
}
async function getChannelEnriched(client, id) {
  const g = await getChannel(client, id);
  if (!g) return null;
  const [{ members }] = (await client.query("SELECT COUNT(*)::int AS members FROM comms_member WHERE group_id = $1", [id])).rows;
  const [{ messages }] = (await client.query("SELECT COUNT(*)::int AS messages FROM comms_message WHERE group_id = $1 AND deleted_at IS NULL", [id])).rows;
  const last = (await client.query("SELECT * FROM comms_message WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", [id])).rows[0] || null;
  return { ...g, member_count: members, message_count: messages, last_message: last };
}
async function findDirectChannel(client, userA, userB) {
  const { rows } = await client.query(
    "SELECT g.group_id FROM comms_group g " +
      "JOIN comms_member a ON a.group_id = g.group_id AND a.user_id = $1 " +
      "JOIN comms_member b ON b.group_id = g.group_id AND b.user_id = $2 " +
      "WHERE g.kind = 'DIRECT' AND (SELECT COUNT(*) FROM comms_member m WHERE m.group_id = g.group_id) = 2 LIMIT 1",
    [userA, userB],
  );
  return rows[0] ? getChannel(client, rows[0].group_id) : null;
}
async function findCustomerThread(client, clientId) {
  const { rows } = await client.query("SELECT * FROM comms_group WHERE kind = 'CLIENT' AND client_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1", [clientId]);
  return rows[0] || null;
}
async function updateChannel(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getChannel(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE comms_group SET " + set + ", updated_at = now() WHERE group_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}

// ── Members ──
async function addMember(client, { groupId, userId, memberRole = "MEMBER" }) {
  const { rows } = await client.query(
    "INSERT INTO comms_member (group_id, user_id, member_role) VALUES ($1,$2,$3) " +
      "ON CONFLICT (group_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role RETURNING *",
    [groupId, userId, memberRole],
  );
  return rows[0];
}
async function removeMember(client, groupId, userId) {
  const { rowCount } = await client.query("DELETE FROM comms_member WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  return rowCount > 0;
}
async function listMembers(client, groupId) {
  return (await client.query(
    "SELECT m.*, u.full_name, u.email FROM comms_member m JOIN app_user u ON u.user_id = m.user_id WHERE m.group_id = $1 ORDER BY m.member_role, u.full_name", [groupId])).rows;
}
async function findMember(client, groupId, userId) {
  return (await client.query("SELECT * FROM comms_member WHERE group_id = $1 AND user_id = $2", [groupId, userId])).rows[0] || null;
}
async function setMemberFlag(client, groupId, userId, field, value) {
  const { rows } = await client.query("UPDATE comms_member SET " + field + " = $3 WHERE group_id = $1 AND user_id = $2 RETURNING *", [groupId, userId, value]);
  return rows[0] || null;
}
async function touchPresence(client, groupId, userId) {
  await client.query("UPDATE comms_member SET last_seen_at = now() WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
}

// ── Messages ──
const insertMessage = (client, data) => insertOne(client, "comms_message", data);
const getMessage = (client, id) => getById(client, "comms_message", "message_id", id);
async function editMessage(client, id, body) {
  const { rows } = await client.query("UPDATE comms_message SET body = $2, edited_at = now() WHERE message_id = $1 AND deleted_at IS NULL RETURNING *", [id, body]);
  return rows[0] || null;
}
async function softDeleteMessage(client, id) {
  const { rows } = await client.query("UPDATE comms_message SET deleted_at = now(), body = NULL WHERE message_id = $1 RETURNING message_id", [id]);
  return rows[0] || null;
}
async function setDelivery(client, id, delivery) {
  const { rows } = await client.query("UPDATE comms_message SET delivery = $2 WHERE message_id = $1 RETURNING *", [id, delivery]);
  return rows[0] || null;
}
async function listMessages(client, groupId, { limit = 50, before = null } = {}) {
  const params = [groupId, Math.min(Math.max(limit, 1), 200)];
  let where = "group_id = $1";
  if (before) { params.push(before); where += " AND created_at < $3"; }
  const { rows } = await client.query("SELECT * FROM comms_message WHERE " + where + " ORDER BY created_at DESC LIMIT $2", params);
  return rows.reverse(); // chronological
}

// ── Reactions / stars / search ──
async function toggleReaction(client, { messageId, userId, emoji }) {
  const existing = await client.query("SELECT 1 FROM comms_reaction WHERE message_id = $1 AND user_id = $2 AND emoji = $3", [messageId, userId, emoji]);
  if (existing.rowCount) { await client.query("DELETE FROM comms_reaction WHERE message_id = $1 AND user_id = $2 AND emoji = $3", [messageId, userId, emoji]); return { added: false }; }
  await client.query("INSERT INTO comms_reaction (message_id, user_id, emoji) VALUES ($1,$2,$3)", [messageId, userId, emoji]);
  return { added: true };
}
async function listReactions(client, messageId) {
  return (await client.query("SELECT emoji, COUNT(*)::int AS count, array_agg(user_id) AS users FROM comms_reaction WHERE message_id = $1 GROUP BY emoji", [messageId])).rows;
}
async function toggleStar(client, { messageId, userId }) {
  const existing = await client.query("SELECT 1 FROM comms_star WHERE message_id = $1 AND user_id = $2", [messageId, userId]);
  if (existing.rowCount) { await client.query("DELETE FROM comms_star WHERE message_id = $1 AND user_id = $2", [messageId, userId]); return { starred: false }; }
  await client.query("INSERT INTO comms_star (message_id, user_id) VALUES ($1,$2)", [messageId, userId]);
  return { starred: true };
}
async function listStarredForUser(client, userId) {
  return (await client.query("SELECT m.* FROM comms_star s JOIN comms_message m ON m.message_id = s.message_id WHERE s.user_id = $1 AND m.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 100", [userId])).rows;
}
async function searchMessages(client, userId, term, { limit = 50 } = {}) {
  return (await client.query(
    "SELECT m.* FROM comms_message m JOIN comms_member mem ON mem.group_id = m.group_id AND mem.user_id = $1 " +
      "WHERE m.deleted_at IS NULL AND m.body ILIKE $2 ORDER BY m.created_at DESC LIMIT $3",
    [userId, "%" + term + "%", Math.min(Math.max(limit, 1), 200)])).rows;
}

// ── Reads ──
async function markChannelRead(client, groupId, userId) {
  await client.query("UPDATE comms_member SET last_read_at = now() WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
}
async function unreadCountForUser(client, userId) {
  return (await client.query(
    "SELECT g.group_id, COUNT(x.message_id)::int AS unread FROM comms_member m JOIN comms_group g ON g.group_id = m.group_id " +
      "LEFT JOIN comms_message x ON x.group_id = g.group_id AND x.deleted_at IS NULL AND x.sender_user_id <> $1 " +
      "  AND (m.last_read_at IS NULL OR x.created_at > m.last_read_at) " +
      "WHERE m.user_id = $1 GROUP BY g.group_id", [userId])).rows;
}

// ── Attachments ──
const addAttachment = (client, data) => insertOne(client, "comms_attachment", data);
async function listAttachments(client, messageId) {
  return (await client.query("SELECT * FROM comms_attachment WHERE message_id = $1 ORDER BY created_at", [messageId])).rows;
}

// ── Drafts ──
async function getDraft(client, groupId, userId) {
  return (await client.query("SELECT * FROM comms_draft WHERE group_id = $1 AND user_id = $2", [groupId, userId])).rows[0] || null;
}
async function upsertDraft(client, { groupId, userId, body }) {
  const { rows } = await client.query(
    "INSERT INTO comms_draft (group_id, user_id, body) VALUES ($1,$2,$3) " +
      "ON CONFLICT (group_id, user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now() RETURNING *",
    [groupId, userId, body]);
  return rows[0];
}
async function deleteDraft(client, groupId, userId) {
  await client.query("DELETE FROM comms_draft WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
}

// ── Quick replies ──
async function listQuickReplies(client, userId) {
  return (await client.query("SELECT * FROM comms_quick_reply WHERE owner_user_id = $1 OR owner_user_id IS NULL ORDER BY label", [userId])).rows;
}
const createQuickReply = (client, data) => insertOne(client, "comms_quick_reply", data);
async function updateQuickReply(client, id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE comms_quick_reply SET " + set + ", updated_at = now() WHERE quick_reply_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function deleteQuickReply(client, id) { await client.query("DELETE FROM comms_quick_reply WHERE quick_reply_id = $1", [id]); }

// ── Colleague directory ──
async function listColleagues(client, q = {}) {
  const { limit, offset } = page(q);
  return (await client.query("SELECT user_id, full_name, email, status FROM app_user WHERE status = 'ACTIVE' ORDER BY full_name LIMIT $1 OFFSET $2", [limit, offset])).rows;
}

module.exports = {
  insertChannel, getChannel, getChannelEnriched, listChannelsForUser, findDirectChannel, findCustomerThread, updateChannel,
  addMember, removeMember, listMembers, findMember, setMemberFlag, touchPresence,
  insertMessage, getMessage, editMessage, softDeleteMessage, setDelivery, listMessages,
  toggleReaction, listReactions, toggleStar, listStarredForUser, searchMessages,
  markChannelRead, unreadCountForUser,
  addAttachment, listAttachments,
  getDraft, upsertDraft, deleteDraft,
  listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
  listColleagues,
};
