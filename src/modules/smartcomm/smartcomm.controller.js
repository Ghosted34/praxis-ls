"use strict";
const service = require("./smartcomm.service");
const calls = require("./smartcomm.call.service");
const callRecords = require("./smartcomm.call.pipeline.service");
const schedule = require("./smartcomm.schedule.service");
const cfg = require("./smartcomm.config.service");
const erp = require("./smartcomm.erp.service");
const links = require("./smartcomm.links.service");
const { asyncHandler, AppError } = require("../../utils/errors");
const { readUpload } = require("../../shared/http/upload.middleware");
const { readPermissions } = require("../../middleware/rbac");
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
  /**
   * The thread, and the link cards for the page that was just read.
   *
   * Two things are threaded down here that the messages themselves do not need:
   * the reader's ERP module set (`erpAllow`, because a record card resolves
   * against WHO is looking) and the tenant handle + env, which the preview path
   * needs for exactly one reason — to put work on the queue. `thread()` never
   * fetches a URL; it reads the cache and, when a URL is new or past its TTL,
   * marks it and enqueues the fetch. A request that fetched would make opening a
   * chat as slow as the slowest link inside it.
   */
  thread: asyncHandler(async (req, res) => {
    const allow = await erpAllow(req);
    const data = await req.tenantDb((c) => service.thread(c, {
      groupId: req.params.id, actor: actor(req), limit: req.query.limit, before: req.query.before, erpAllow: allow,
      tenantMeta: req.tenant, env: req.env,
    }));
    res.json({ data });
  }),
  /**
   * One link's preview, on demand, while the composer still has the keystrokes.
   *
   * `create`, and deliberately NOT `view`, which the shape of the endpoint
   * (a read) would otherwise suggest: it makes an outbound HTTP request from the
   * tenant's server to an address supplied by the caller, which is a side effect
   * with a victim. Every other endpoint in this module that reaches outside the
   * tenant — `config/email/test`, `config/email/test-send`, the WhatsApp test —
   * is gated the same way, for the same reason, and the note above `edit` in
   * routes.js is what makes that a rule rather than a coincidence.
   */
  linkPreview: A((c, req) => links.previewNow(req.body.url)),
  /**
   * The image behind a card, from our own cache.
   *
   * `view` because it is a read of a picture the caller's channel already
   * earned, and it takes no URL: the parameter is the sha256 of a LINK, and the
   * only bytes it can ever return are the ones this tenant's unfurl already
   * stored for it. That is what makes it safe to hand to an `<img>`-adjacent blob
   * fetch, and why there is no allowlist here — the allowlist is the cache.
   */
  linkImage: asyncHandler(async (req, res) => {
    const found = await req.tenantDb((c) => links.imageFor(c, req.query.link, req.query.part === "icon" ? "icon" : "image"));
    if (!found) {
      // A 404 rather than a placeholder: the bubble already knows how to draw a
      // card with no image, and inventing one here would mean a graphic that
      // implies the page HAD an image when the fetch failed or was refused.
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No preview image for that link" } });
      return;
    }
    res.setHeader("Content-Type", found.contentType);
    // Private, and immutable for as long as the cache row lives: the bytes are
    // the same for every reader of this tenant, and re-fetching them on every
    // scroll of a thread is the traffic this proxy exists to avoid. No
    // `default-src` relaxation, no sniffing, and nothing that can script: this is
    // an image response and it is served like one.
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; img-src 'self' data:");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.end(found.buffer);
  }),
  post: C((c, req) => service.postMessage(c, {
    groupId: req.params.id, body: req.body.body, mediaVaultId: req.body.media_vault_id,
    replyTo: req.body.reply_to, attachments: req.body.attachments, actor: actor(req),
    // Sent from a person's keystrokes, so the preview work is queued NOW rather
    // than waiting for the first reader of the thread. Every OTHER producer of a
    // message (the task-blockage DM, a mail mention, an import) does not pass
    // this, and nothing is lost by it: their links are found at read time like
    // any other, one page view later.
    tenantMeta: req.tenant, env: req.env,
  })),
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
   * NOTHING is transcribed here. A voice note used to fire a provider call the
   * moment it landed, for every clip in every channel, on the guess that
   * somebody would want the words. Most are listened to once by two people. The
   * words are now asked for — see `transcribeMedia` below.
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
  }),

  /**
   * Transcribe one voice note, because a member pressed Transcribe.
   *
   * Awaited, unlike the fire-and-forget this replaces: somebody is looking at a
   * spinner, and a request whose whole purpose is to produce a sentence should
   * answer with the sentence. The channel is told over realtime as well, so the
   * words land under the bubble for everyone else with the thread open.
   *
   * `language` is a hint, not a promise — see `transcription.service.js` for
   * what Whisper does with the wrong one.
   */
  transcribeMedia: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.transcribeVoiceNote(c, {
      mediaId: req.params.mediaId,
      language: (req.body && req.body.language) || null,
      actor: actor(req),
    }));
    res.json({ data });
  }),

  // ── The call record half ────────────────────────────────────────────────
  /**
   * One recorded part, uploaded as it closes (a complete audio file). Answers
   * the PART at once; its transcription is a job of its own.
   */
  uploadCallRecording: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    const body = req.body || {};
    const data = await req.tenantDb((c) => callRecords.registerPart(c, {
      callId: req.params.id,
      actor: actor(req),
      side: body.side,
      partIndex: body.part_index,
      partCount: body.part_count,
      durationMs: body.duration_ms,
      language: body.language || null,
      file,
      slug: req.tenant.slug,
      tenantMeta: req.tenant,
      env: req.env,
    }));
    res.status(201).json({ data });
  }),

  /** A side declares it has finished recording, and how many parts it made. */
  completeCallRecording: A((c, req) => callRecords.completeSide(c, {
    callId: req.params.id,
    actor: actor(req),
    side: req.body.side,
    parts: req.body.parts,
    tenantMeta: req.tenant,
    env: req.env,
  })),

  /** An admin re-runs a part that failed on both providers (never automatic). */
  rerunCallRecordingPart: A((c, req) => callRecords.rerunPart(c, {
    callId: req.params.id,
    actor: actor(req),
    side: req.params.side,
    partIndex: Number(req.params.part),
    tenantMeta: req.tenant,
    env: req.env,
  })),

  getCallTranscript: A((c, req) => callRecords.getTranscript(c, {
    callId: req.params.id, actor: actor(req),
  })),
  getCallSummary: A((c, req) => callRecords.getSummary(c, {
    callId: req.params.id, actor: actor(req),
  })),
  sendCallSummary: A((c, req) => callRecords.sendSummary(c, {
    callId: req.params.id,
    actor: actor(req),
    summaryText: req.body.summary_text,
    keyPoints: req.body.key_points,
    followUps: req.body.follow_ups,
    tenantMeta: req.tenant,
    env: req.env,
  })),
  discardCallSummary: A((c, req) => callRecords.discardSummary(c, {
    callId: req.params.id, actor: actor(req),
  })),
  // 202: the rewrite is a job; `call:summary_ready` (redraft) says it is done.
  regenerateCallSummary: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => callRecords.requestRegenerate(c, {
      callId: req.params.id,
      actor: actor(req),
      language: req.body.language,
      tenantMeta: req.tenant,
      env: req.env,
    }));
    res.status(202).json({ data });
  }),
  /** The browser live capture was retired in PR-1 and nothing reads it. */
  callLiveLogGone: (_req, _res, next) => next(new AppError("GONE", "The live transcript upload has been retired", 410)),

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
  // ── 1:1 voice calls (PR-1) ───────────────────────────────────────────────
  // Membership is asserted in the call service (the channel is the
  // authorisation); the state machine is server-authoritative there too, so
  // the handlers stay thin.
  createCall: C((c, req) => calls.createCall(c, {
    groupId: req.body.group_id, actor: actor(req), tenantMeta: req.tenant, env: req.env,
  })),
  acceptCall: A((c, req) => calls.acceptCall(c, {
    id: req.params.id, actor: actor(req), tenantMeta: req.tenant, env: req.env,
  })),
  declineCall: A((c, req) => calls.declineCall(c, {
    id: req.params.id, actor: actor(req), tenantMeta: req.tenant, env: req.env,
  })),
  // The body's `reason` is ignored: the server decides it (audit B9).
  hangupCall: A((c, req) => calls.hangup(c, {
    id: req.params.id, actor: actor(req), tenantMeta: req.tenant, env: req.env,
  })),
  callFailed: A((c, req) => calls.reportFailure(c, {
    id: req.params.id, actor: actor(req), tenantMeta: req.tenant, env: req.env,
  })),
  listCalls: A((c, req) => calls.listCalls(c, actor(req))),
  getCall: A((c, req) => calls.getCall(c, { id: req.params.id, actor: actor(req) })),
  callTurn: A((c, req) => calls.turnFor(c, { id: req.params.id, actor: actor(req) })),
  // PR-4: what is ringing for me (A13), and a ring to this device only (A15).
  listRingingCalls: A((c, req) => calls.listRinging(c, actor(req))),
  testRing: A((c, req) => calls.testRing(c, { actor: actor(req), endpoint: req.body.endpoint })),
};
