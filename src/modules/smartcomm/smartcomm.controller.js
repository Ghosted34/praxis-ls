"use strict";
const service = require("./smartcomm.service");
const { asyncHandler } = require("../../utils/errors");
const actor = (req) => req.user || { user_id: null };
const A = (fn) => asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => fn(c, req)) }));
const C = (fn) => asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => fn(c, req)) }));
module.exports = {
  listChannels: A((c, req) => service.listChannels(c, actor(req), req.query)),
  createChannel: C((c, req) => service.createChannel(c, { data: req.body, actor: actor(req) })),
  getChannel: A((c, req) => service.getChannel(c, { id: req.params.id, actor: actor(req) })),
  archive: A((c, req) => service.setArchived(c, { id: req.params.id, archived: req.body.archived === true, actor: actor(req) })),
  members: A((c, req) => service.listMembers(c, { groupId: req.params.id })),
  addMember: C((c, req) => service.addMember(c, { groupId: req.params.id, userId: req.body.user_id, memberRole: req.body.member_role, actor: actor(req) })),
  removeMember: A((c, req) => service.removeMember(c, { groupId: req.params.id, userId: req.params.userId, actor: actor(req) })),
  pin: A((c, req) => service.setPinned(c, { groupId: req.params.id, pinned: req.body.pinned === true, actor: actor(req) })),
  mute: A((c, req) => service.setMuted(c, { groupId: req.params.id, muted: req.body.muted === true, actor: actor(req) })),
  thread: A((c, req) => service.thread(c, { groupId: req.params.id, actor: actor(req), limit: req.query.limit, before: req.query.before })),
  post: C((c, req) => service.postMessage(c, { groupId: req.params.id, body: req.body.body, mediaVaultId: req.body.media_vault_id, replyTo: req.body.reply_to, attachments: req.body.attachments, actor: actor(req) })),
  edit: A((c, req) => service.editMessage(c, { messageId: req.params.messageId, body: req.body.body, actor: actor(req) })),
  del: A((c, req) => service.deleteMessage(c, { messageId: req.params.messageId, actor: actor(req) })),
  react: A((c, req) => service.react(c, { messageId: req.params.messageId, emoji: req.body.emoji, actor: actor(req) })),
  star: A((c, req) => service.star(c, { messageId: req.params.messageId, actor: actor(req) })),
  starred: A((c, req) => service.starred(c, actor(req))),
  search: A((c, req) => service.search(c, { actor: actor(req), term: req.query.q })),
  markRead: A((c, req) => service.markRead(c, { groupId: req.params.id, actor: actor(req) })),
  unread: A((c, req) => service.unread(c, actor(req))),
  getDraft: A((c, req) => service.getDraft(c, { groupId: req.params.id, actor: actor(req) })),
  saveDraft: A((c, req) => service.saveDraft(c, { groupId: req.params.id, body: req.body.body, actor: actor(req) })),
  clearDraft: A((c, req) => service.clearDraft(c, { groupId: req.params.id, actor: actor(req) })),
  listQuickReplies: A((c, req) => service.listQuickReplies(c, actor(req))),
  createQuickReply: C((c, req) => service.createQuickReply(c, { data: req.body, actor: actor(req) })),
  updateQuickReply: A((c, req) => service.updateQuickReply(c, { id: req.params.id, patch: req.body })),
  deleteQuickReply: A((c, req) => service.deleteQuickReply(c, { id: req.params.id })),
  colleagues: A((c, req) => service.colleagues(c, req.query)),
  certify: A((c, req) => service.certifiedExport(c, { groupId: req.params.id, actor: actor(req) })),
};
