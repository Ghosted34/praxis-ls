"use strict";
const service = require("./smartcomm.service");
const schedule = require("./smartcomm.schedule.service");
const cfg = require("./smartcomm.config.service");
const erp = require("./smartcomm.erp.service");
const { asyncHandler, AppError } = require("../../utils/errors");
const { readUpload } = require("../../shared/http/upload.middleware");
const { readPermissions } = require("../../middleware/rbac");
const { logger } = require("../../config/logger");
const actor = (req) => req.user || { user_id: null };

/**
 * The module keys THIS caller may view, as a Set.
 *
 * Every ERP reference in the product resolves against this rather than against
 * the sender who attached it — an ops coordinator and a finance controller sit
 * in the same dossier channel and only one of them is supposed to see what the
 * client is being charged. Resolved once per request and threaded down, because
 * one thread render carries as many references as it has bubbles.
 */
async function erpAllow(req) {
  const specs = erp.ALL_MODULES.map((m) => [m, "view"]);
  const results = await readPermissions(req, specs);
  return new Set(erp.ALL_MODULES.filter((_, i) => results[i]));
}
const A = (fn) => asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => fn(c, req)) }));
const C = (fn) => asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => fn(c, req)) }));
module.exports = {
  scheduled: A((c, req) => schedule.list(c, { groupId: req.params.id, actor: actor(req) })),
  schedule: C((c, req) => schedule.create(c, { groupId: req.params.id, actor: actor(req), data: req.body, env: req.env })),
  reschedule: A((c, req) => schedule.change(c, { id: req.params.id, actor: actor(req), data: req.body })),
  cancelScheduled: A((c, req) => schedule.change(c, { id: req.params.id, actor: actor(req), data: { cancel: true } })),
  // ── Channel provider config (WhatsApp / email) ──
  getCommsConfig: A((c) => cfg.getConfig(c)),
  setWhatsapp: A((c, req) => cfg.setWhatsapp(c, { ...req.body, actor: actor(req) })),
  setEmail: A((c, req) => cfg.setEmail(c, { ...req.body, actor: actor(req) })),
  testWhatsapp: A((c) => cfg.testWhatsapp(c)),
  testEmail: A((c, req) => cfg.testEmail(c, { purpose: req.body && req.body.purpose })),
  // Mail-setup wizard probes.
  dnsCheck: A((c, req) => cfg.dnsCheck(c, { domain: req.body.domain })),
  testSend: A((c, req) => cfg.testSend(c, { to: req.body.to, purpose: req.body.purpose })),
  listChannels: A((c, req) => service.listChannels(c, actor(req), req.query)),
  createChannel: C((c, req) => service.createChannel(c, { data: req.body, actor: actor(req) })),
  getChannel: A((c, req) => service.getChannel(c, { id: req.params.id, actor: actor(req) })),
  archive: A((c, req) => service.setArchived(c, { id: req.params.id, archived: req.body.archived === true, actor: actor(req) })),
  members: A((c, req) => service.listMembers(c, { groupId: req.params.id, actor: req.user })),
  addMember: C((c, req) => service.addMember(c, { groupId: req.params.id, userId: req.body.user_id, memberRole: req.body.member_role, actor: actor(req) })),
  removeMember: A((c, req) => service.removeMember(c, { groupId: req.params.id, userId: req.params.userId, actor: actor(req) })),
  pin: A((c, req) => service.setPinned(c, { groupId: req.params.id, pinned: req.body.pinned === true, actor: actor(req) })),
  mute: A((c, req) => service.setMuted(c, { groupId: req.params.id, muted: req.body.muted === true, actor: actor(req) })),
  thread: asyncHandler(async (req, res) => {
    const allow = await erpAllow(req);
    const data = await req.tenantDb((c) => service.thread(c, {
      groupId: req.params.id, actor: actor(req), limit: req.query.limit, before: req.query.before, erpAllow: allow,
    }));
    res.json({ data });
  }),
  post: C((c, req) => service.postMessage(c, { groupId: req.params.id, body: req.body.body, mediaVaultId: req.body.media_vault_id, replyTo: req.body.reply_to, attachments: req.body.attachments, actor: actor(req) })),
  edit: A((c, req) => service.editMessage(c, { messageId: req.params.messageId, body: req.body.body, actor: actor(req) })),
  del: A((c, req) => service.deleteMessage(c, { messageId: req.params.messageId, actor: actor(req) })),
  react: A((c, req) => service.react(c, { messageId: req.params.messageId, emoji: req.body.emoji, actor: actor(req) })),
  star: A((c, req) => service.star(c, { messageId: req.params.messageId, actor: actor(req) })),
  ack: A((c, req) => service.acknowledge(c, { messageId: req.params.messageId, actor: actor(req) })),
  starred: A((c, req) => service.starred(c, actor(req))),
  search: A((c, req) => service.search(c, { actor: actor(req), term: req.query.q })),
  markRead: A((c, req) => service.markRead(c, { groupId: req.params.id, actor: actor(req) })),
  unread: A((c, req) => service.unread(c, actor(req))),
  getDraft: A((c, req) => service.getDraft(c, { groupId: req.params.id, actor: actor(req) })),
  saveDraft: A((c, req) => service.saveDraft(c, { groupId: req.params.id, body: req.body.body, actor: actor(req) })),
  clearDraft: A((c, req) => service.clearDraft(c, { groupId: req.params.id, actor: actor(req) })),
  listQuickReplies: A((c, req) => service.listQuickReplies(c, actor(req))),
  createQuickReply: C((c, req) => service.createQuickReply(c, { data: req.body, actor: actor(req) })),
  updateQuickReply: A((c, req) => service.updateQuickReply(c, { id: req.params.id, patch: req.body, actor: actor(req) })),
  deleteQuickReply: A((c, req) => service.deleteQuickReply(c, { id: req.params.id, actor: actor(req) })),
  colleagues: A((c, req) => service.colleagues(c, req.query)),

  // ── Media ──
  /**
   * Upload one attachment into a channel.
   *
   * Accepts either transport — multipart (what the composer sends) or a base64
   * data URL (what the voice recorder's fallback sends) — through `readUpload`,
   * which is the seam that lets both exist without the route caring.
   *
   * A voice note's transcription is fired AFTER the response, deliberately
   * unawaited: the clip is the message and the words are an improvement on it,
   * so a provider that is slow or unconfigured must never be the reason a voice
   * note fails to send.
   */
  uploadMedia: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    if (!file) throw new AppError("NO_FILE", "No file in this upload", 400);
    // The validator has already coerced the multipart strings and normalised
    // `waveform` from its JSON-string form into an array — see `mediaUpload`.
    const body = req.body || {};
    const isVoiceNote = body.is_voice_note === true || body.is_voice_note === "true";
    const data = await req.tenantDb((c) => service.uploadMedia(c, {
      groupId: req.params.id,
      file,
      isVoiceNote,
      durationMs: body.duration_ms,
      waveform: body.waveform,
      width: body.width ? Number(body.width) : null,
      height: body.height ? Number(body.height) : null,
      slug: req.tenant.slug,
      actor: actor(req),
    }));
    res.status(201).json({ data });
    if (isVoiceNote && data.media_id) {
      req.tenantDb((c) => service.transcribeVoiceNote(c, { mediaId: data.media_id, groupId: req.params.id }))
        .catch((err) => logger.warn({ err, media_id: data.media_id }, "voice note transcription did not complete"));
    }
  }),

  /**
   * The bytes of one chat attachment, for a member of its channel.
   *
   * Not served by the `/media/<key>` static mount: that one is unauthenticated
   * with an allow-list of public prefixes (the logo, the login background), and
   * a private conversation's attachments are the opposite of that. Knowing the
   * storage key grants nothing here — membership does.
   *
   * `private, max-age` rather than `no-store`: the same photo is re-fetched
   * every time the thread scrolls past it, and a conversation is read many
   * times. Private keeps it out of any shared cache on the way.
   */
  mediaBytes: asyncHandler(async (req, res) => {
    const { media, buffer } = await req.tenantDb((c) => service.mediaBytes(c, {
      mediaId: req.params.mediaId, actor: actor(req),
    }));
    res.setHeader("Content-Type", media.content_type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    // `inline` for a photo or a clip the bubble plays in place; the filename is
    // still offered so "save as" does not produce a uuid.
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(media.original_name || "attachment")}"`);
    res.send(buffer);
  }),

  promoteMedia: A((c, req) => service.promoteMedia(c, {
    mediaId: req.params.mediaId, actor: actor(req), slug: req.tenant.slug,
    docType: req.body && req.body.doc_type, entityRef: req.body && req.body.entity_ref,
  })),

  // ── ERP references ──
  erpSearch: asyncHandler(async (req, res) => {
    const allow = await erpAllow(req);
    const kinds = req.query.kinds ? String(req.query.kinds).split(",").map((k) => k.trim()).filter(Boolean) : null;
    const data = await req.tenantDb((c) => service.erpSearch(c, {
      term: req.query.q, allow, kinds, limit: req.query.limit,
    }));
    res.json({ data });
  }),

  erpCard: asyncHandler(async (req, res) => {
    const allow = await erpAllow(req);
    const data = await req.tenantDb((c) => service.erpCard(c, {
      kind: req.params.kind, id: req.params.id, allow,
    }));
    res.json({ data });
  }),
  certify: A((c, req) => service.certifiedExport(c, { groupId: req.params.id, actor: actor(req) })),
};
