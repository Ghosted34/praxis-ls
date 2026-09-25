/** Smart Comms (MOD-64) — corporate WhatsApp-style. Gated; feature comms.
 *  Membership is enforced in the service (you only see channels you belong to). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const c = require("./smartcomm.controller");
const v = require("./smartcomm.validator");
const { singleFile } = require("../../shared/http/upload.middleware");

const M = "MOD-64";
const view = requirePermission(M, "view");
const create = requirePermission(M, "create");
const router = express.Router();
router.use(authMiddleware);

// outbound provider config (WhatsApp / email) — set + live test. Writes/tests
// decrypt + call out, so they are gated on create; the read is redacted.
router.get("/config", view, c.getCommsConfig);
router.put("/config/whatsapp", create, v.whatsappConfig, c.setWhatsapp);
router.put("/config/email", create, v.emailConfig, c.setEmail);
router.post("/config/whatsapp/test", create, c.testWhatsapp);
router.post("/config/email/test", create, v.emailTest, c.testEmail);
// Mail-setup wizard (Comms → Setup guide). dns-check reads PUBLIC DNS — a
// read, gated `view`; test-send sends a real message through the tenant's
// transport — a write with side effects, gated `create` like the other tests.
router.post("/config/email/dns-check", view, v.emailDnsCheck, c.dnsCheck);
router.post("/config/email/test-send", create, v.emailTestSend, c.testSend);

// directory + cross-channel reads
router.get("/colleagues", view, c.colleagues);
router.get("/unread", view, c.unread);
router.get("/starred", view, c.starred);
router.get("/search", view, c.search);
router.get("/quick-replies", view, c.listQuickReplies);
router.post("/quick-replies", create, v.quickReply, c.createQuickReply);
router.patch("/quick-replies/:id", create, v.quickReplyPatch, c.updateQuickReply);
router.delete("/quick-replies/:id", create, c.deleteQuickReply);

/**
 * API F-22 — the declared RBAC action must describe what the endpoint DOES.
 *
 * Eight write endpoints were gated on `view`, so granting a role "MOD-64: view"
 * also granted "add and remove channel members" and "archive a channel". An
 * administrator configuring the permission matrix had no way to know that; the
 * matrix said read and the routes meant write.
 *
 * Two kinds of write are distinguished here, because they are genuinely
 * different rights and collapsing them would be its own inaccuracy:
 *
 *   `edit`   — changes something OTHER PEOPLE see: channel membership, the
 *              archived flag, another message's content or existence.
 *   `view`   — changes only the CALLER'S OWN relationship to a channel: their
 *              pin, their mute, their read marker, their draft, their star,
 *              their reaction. These are per-user rows keyed on the caller and
 *              are meaningless to anyone else, so requiring a write grant to
 *              mute a channel you can already read would be the opposite
 *              mistake. They keep `view`, now deliberately and in writing.
 *
 * Membership remains the real authorisation in every case — `assertMember` in
 * the service — and that is unchanged. This is about the permission matrix
 * telling the truth.
 */
const edit = requirePermission(M, "edit");

// channels
router.get("/channels", view, c.listChannels);
router.post("/channels", create, v.channel, c.createChannel);
router.get("/channels/:id", view, c.getChannel);
router.post("/channels/:id/archive", edit, v.flag, c.archive);
router.get("/channels/:id/members", view, c.members);
router.post("/channels/:id/members", edit, v.member, c.addMember);
router.delete("/channels/:id/members/:userId", edit, c.removeMember);
// Own-preference writes: per-user rows keyed on the caller. See the note above.
router.post("/channels/:id/pin", view, v.flag, c.pin);
router.post("/channels/:id/mute", view, v.flag, c.mute);
router.post("/channels/:id/read", view, c.markRead);
router.get("/channels/:id/draft", view, c.getDraft);
router.put("/channels/:id/draft", view, v.draft, c.saveDraft);
router.delete("/channels/:id/draft", view, c.clearDraft);
router.post("/channels/:id/certify", requirePermission(M, "approve"), c.certify);

/**
 * Attachments, chat media and ERP references.
 *
 * `create`, not `view`: an upload writes bytes into tenant storage and a row
 * into the database, and the gate must say so. Membership is still the real
 * authorisation — `assertMember` in the service — for the same reason it is
 * everywhere else in this module.
 *
 * `singleFile` must run BEFORE the validator: a multipart body is parsed by
 * multer, so without it `req.body` is empty and every field 422s.
 */
router.post("/channels/:id/media", create, singleFile("file"), v.mediaUpload, c.uploadMedia);
// Reading one attachment is a read of the conversation it belongs to. NOT the
// unauthenticated /media/<key> static mount — see the controller.
router.get("/media/:mediaId", view, c.mediaBytes);
// "Save to vault" files a chat image as a real document, which is a write other
// people see: it appears in the document register for everyone with vault
// rights, and it is meant to.
router.post("/media/:mediaId/promote", edit, v.promote, c.promoteMedia);
/**
 * "Transcribe this voice note" — `view`, deliberately, and here is why.
 *
 * It writes a row other people see, which by the rule stated above reads like
 * `edit`. It is gated on `view` anyway, because what it produces is not new
 * content: it is the words that are ALREADY in a message the caller is allowed
 * to play, in a form they can read. Requiring a write grant would mean a
 * warehouse role with read access can hear every voice note in its channel and
 * is the one kind of member who can never read one — which is the accessibility
 * hole the transcript exists to close, reinstated by the permission matrix.
 *
 * Membership is the real authorisation, asserted in the media service, and it
 * matters more here than on most reads: this endpoint spends money on the
 * tenant's provider account.
 */
router.post("/media/:mediaId/transcribe", view, v.transcribe, c.transcribeMedia);
// Both reads, and both resolve against the CALLER's permissions rather than the
// sender's — a member without MOD-51 gets the reference and no figure. MOD-64
// `view` is the gate to reach them at all; the per-record rights are applied
// inside. See smartcomm.erp.service.js.
router.get("/erp/search", view, c.erpSearch);
router.get("/erp/:kind/:id", view, c.erpCard);

/**
 * Link previews.
 *
 * `links/image` is the only file route in this module that answers with bytes
 * rather than a JSON descriptor, and it is not an open proxy: it takes the hash
 * of a LINK, not a URL, and can only return the image this tenant's own unfurl
 * already recorded for it (see the controller). The two are on different
 * permissions for the reason spelled out on every other route here — reading a
 * cached picture is a read; making the server go and fetch a page is not.
 */
router.post("/links/preview", create, v.linkPreview, c.linkPreview);
router.get("/links/image", view, c.linkImage);

// Durable scheduled messages (personal management, never other senders' rows).
router.get("/channels/:id/scheduled", view, c.scheduled);
router.post("/channels/:id/scheduled", create, v.scheduled, c.schedule);
router.patch("/scheduled/:id", create, v.reschedule, c.reschedule);
router.delete("/scheduled/:id", view, c.cancelScheduled);

// messages
router.get("/channels/:id/messages", view, c.thread);
router.post("/channels/:id/messages", create, v.message, c.post);
// Editing and deleting a message is a write to shared content. Sender-ownership
// is still asserted in the service on top of this.
router.patch("/messages/:messageId", edit, v.editMessage, c.edit);
router.delete("/messages/:messageId", edit, c.del);
// Own-preference writes again: a reaction and a star are rows keyed on the caller.
router.post("/messages/:messageId/react", view, v.react, c.react);
// G22 — acknowledge a message (read receipt on a directive). Any member may
// acknowledge; the sender sees acknowledged_by/acknowledged_at on the row.
router.post("/messages/:messageId/acknowledge", view, c.ack);
router.post("/messages/:messageId/star", view, c.star);

// ── 1:1 voice calls (PR-1) ─────────────────────────────────────────────────
//
// Gated on the `calls` feature ON TOP of MOD-64: the comms gate says "this
// tenant has chat", the calls gate is the tenant's kill switch for the call
// feature specifically (guide decision row 2). Off, the routes answer 403
// FEATURE_DISABLED and the dial icon does not render — one flag, two honest
// surfaces.
//
// RBAC: dialing is `create` (it starts a new interaction, like a message);
// accepting/declining/hanging up is `view`, the same deliberate choice as
// acknowledging a message — each of those is the user's own state in an
// interaction they are part of, and the other participant only ever sees the
// state change, never anything the actor wrote.
const { requireFeature } = require("../../middleware/feature-gate");
const callsOn = requireFeature("calls");
/**
 * The RECORD flag (PR-2 decision row 2) on top of `calls`: calls can be live
 * with recording off — a tenant that cannot keep audio still wants to talk —
 * and that switch is the consent story's tenant half. Off, these routes answer
 * 403 FEATURE_DISABLED and the recorder never arms or uploads.
 */
const recordOn = requireFeature("call_recording");
/**
 * Rate limits on the call routes that ring a person or spend money (audit
 * C6, C2, C8). Per caller for dialing and TURN credentials, per call for the
 * summary rewrite (each rewrite is an LLM call) and per admin for part
 * re-runs (each is a transcription). The service adds a per-callee dial
 * limit, since only it knows who is being rung.
 */
const { makeLimiter } = require("../../shared/http/rate-limit");
const byUser = (name) => (req) => `${name}:${(req.tenant && req.tenant.slug) || "-"}:${(req.user && req.user.user_id) || req.ip}`;
const MINUTE = 60 * 1000;
const dialLimiter = makeLimiter({ name: "call-dial", max: 8, windowMs: MINUTE, keyGenerator: byUser("dial") });
const turnLimiter = makeLimiter({ name: "call-turn", max: 30, windowMs: 10 * MINUTE, keyGenerator: byUser("turn") });
const rerunLimiter = makeLimiter({ name: "call-part-rerun", max: 10, windowMs: 10 * MINUTE, keyGenerator: byUser("rerun") });
// A test ring is a real, high-urgency push: a few per person are plenty.
const testRingLimiter = makeLimiter({ name: "call-test-ring", max: 5, windowMs: 10 * MINUTE, keyGenerator: byUser("testring") });
const regenerateLimiter = makeLimiter({
  name: "call-regenerate",
  max: 3,
  windowMs: 10 * MINUTE,
  // Postgres reads a uuid written upper-case, without hyphens or in braces
  // as the same id; the key must too, or each spelling gets its own budget.
  keyGenerator: (req) => `regen:${(req.tenant && req.tenant.slug) || "-"}:${String(req.params.id).toLowerCase().replace(/[^0-9a-f]/g, "")}`,
});
router.post("/calls", create, callsOn, dialLimiter, v.callCreate, c.createCall);

// ── Test calls (PR-7, owner decision O5) ───────────────────────────────────
//
// Every route needs the Test right on Smart Comms (MOD-64 `test`, held by no
// role until granted: a run spends provider credit) and the `calls` feature.
// The 3-a-day cap is the server's, in the run table; the start limiter only
// stops a double-click from reaching it.
const test = requirePermission("MOD-64", "test");
const diagLimiter = makeLimiter({ name: "call-diagnostics", max: 30, windowMs: 10 * MINUTE, keyGenerator: byUser("diag") });
router.get("/diagnostics/runs", test, callsOn, c.diagList);
router.post("/diagnostics/runs", test, callsOn, diagLimiter, v.diagStart, c.diagStart);
router.get("/diagnostics/runs/:id", test, callsOn, c.diagGet);
router.post("/diagnostics/runs/:id/signal", test, callsOn, v.diagSignal, c.diagSignal);
router.post("/diagnostics/runs/:id/ring", test, callsOn, diagLimiter, v.diagRing, c.diagRing);
router.get("/diagnostics/runs/:id/ice", test, callsOn, c.diagIce);
router.put("/diagnostics/runs/:id/steps/:key", test, callsOn, v.diagStep, c.diagStep);
router.post("/diagnostics/runs/:id/parts", test, callsOn, singleFile("file"), v.diagPart, c.diagPart);
router.post("/diagnostics/runs/:id/finish", test, callsOn, c.diagFinish);
// PR-4. Declared before `/calls/:id`, which would otherwise read "ringing"
// and "test-ring" as call ids.
router.get("/calls/ringing", view, callsOn, c.listRingingCalls);
router.post("/calls/test-ring", view, callsOn, testRingLimiter, v.callTestRing, c.testRing);
// PR-6 (audit G2): who receives this tenant's call data, from the configured
// vendors. Read by the consent line on the ring and Settings → Calls.
router.get("/calls/processing", view, callsOn, c.callProcessing);
// PR-6 (audit F10): what this person's app may offer — calls on, may dial,
// recording on, settings admin. Not behind `callsOn`: its answer IS whether
// calls are on, so the phone icon never renders into a 403.
router.get("/calls/capabilities", view, c.callCapabilities);
// PR-6 (audit G3): a settings admin erases one person's call records.
router.post("/calls/erase-user", requirePermission("MOD-70", "edit"), v.callEraseUser, c.eraseUserCallRecords);
router.post("/calls/:id/accept", view, callsOn, v.callAccept, c.acceptCall);
router.post("/calls/:id/decline", view, callsOn, c.declineCall);
router.post("/calls/:id/hangup", view, callsOn, v.callHangup, c.hangupCall);
// ICE exhausted — the engine gives up before the call ever connected.
router.post("/calls/:id/fail", view, callsOn, c.callFailed);
router.get("/calls", view, callsOn, c.listCalls);
router.get("/calls/:id", view, callsOn, c.getCall);
// A refreshed TURN credential mid-call (the one minted at dial expires with
// the call, plus margin).
router.get("/calls/:id/turn", view, callsOn, turnLimiter, c.callTurn);

// ── The call record half (PR-2) ────────────────────────────────────────────
//
// Every route here is a PARTICIPANT route: the call service resolves the id to
// a person and refuses a stranger with the same NOT_FOUND a nonexistent call
// gets, so knowing a call id is never a way to read someone's conversation.
// RBAC stays `view` for the same reason the PR-1 transitions do — the actor is
// reporting on a call they are already in, and the only thing a route like
// `/summary/send` writes is a message into a channel the caller is a member of.
//
// `singleFile("file")` is mounted BEFORE the validator on the multipart route,
// and that order is load-bearing: the middleware is what parses the multipart
// body into `req.body` for the validator to read, and what puts the buffer
// where `readUpload` looks for it.
router.post("/calls/:id/recording",
  view, recordOn, singleFile("file"), v.callRecording, c.uploadCallRecording);
router.post("/calls/:id/recording/complete", view, recordOn, v.callRecordingComplete, c.completeCallRecording);
// Re-running a failed part spends provider credit, so it is a settings
// admin's action (MOD-70 edit), still only on a call the admin took part in.
router.post("/calls/:id/recording/:side/:part/rerun",
  requirePermission("MOD-70", "edit"), recordOn, rerunLimiter, c.rerunCallRecordingPart);
// The browser live capture was retired in PR-1: 410 for any old client.
router.post("/calls/:id/live-log", view, c.callLiveLogGone);
router.get("/calls/:id/transcript", view, recordOn, c.getCallTranscript);
router.get("/calls/:id/summary", view, recordOn, c.getCallSummary);
router.post("/calls/:id/summary/send", view, recordOn, v.callSummarySend, c.sendCallSummary);
router.post("/calls/:id/summary/discard", view, recordOn, c.discardCallSummary);
router.post("/calls/:id/summary/regenerate", view, recordOn, regenerateLimiter, v.callSummaryRegenerate, c.regenerateCallSummary);

module.exports = { basePath: "/smartcomm", feature: "comms", router };
