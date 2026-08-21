/**
 * The AI surface (§8.11).
 *
 * Two things about this file are load-bearing and easy to undo by accident.
 *
 * 1. EVERY ROUTE PASSES `actor(req)` INTO THE SERVICE. The grounding whitelist
 *    re-checks RBAC per source against the CALLER — mail's own MOD-72 grant
 *    says nothing about whether this user may read invoices — and a service
 *    called with no user withholds every source. Dropping the argument does not
 *    throw; it silently produces an ungrounded draft. That is precisely the
 *    failure this chapter was rebuilt to remove, so it is stated here rather
 *    than left to be noticed.
 *
 * 2. `requireFeature("mail.ai")` is the FLOOR, not the gate. The real gate is
 *    `assist.service.assertAiOn`, which also resolves the platform ceiling, the
 *    tenant's own preference, the caller's grant and the budget. The middleware
 *    is here so an unauthorised request is refused before it costs a query; it
 *    is not sufficient on its own, and the service does not trust it.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler } = require("../../../utils/errors");
const { z } = require("zod");
const { body, params } = require("../../../shared/http/validate");
const service = require("./assist.service");
const ocr = require("./ocr.service");
const semantic = require("./semantic.service");

const router = express.Router();
router.use(authMiddleware);
router.use(requireFeature("mail.ai"));

/** See note 1 in the header. */
const actor = (req) => req.user || null;

const TONE = z.enum([
  "formal", "friendly", "concise", "persuasive", "apologetic",
  "payment", "escalation", "technical", "followup", "notice",
]);
const ACTION = z.enum(["grammar", "shorten", "expand", "to_fr", "to_en"]);

router.post("/assist/compose", requirePermission("MOD-72", "view"),
  body(z.object({
    mode: z.string().max(32).optional(),
    // Enumerated rather than free strings. The tone catalogue is a fixed list
    // of ten named products (§8.1) and metering buckets on it; accepting an
    // arbitrary string would let a caller mint a metering category and, worse,
    // fall through to "formal" silently when they typo one.
    tone: TONE.optional(),
    action: ACTION.optional(),
    thread_id: z.string().uuid().optional(),
    draft: z.string().max(20000).optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.compose(c, req.body, actor(req))),
  })));

router.post("/assist/draft", requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid(),
    language: z.enum(["en", "fr"]).optional(),
    tone: TONE.optional(),
    instruction: z.string().max(2000).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.draft(c, {
      threadId: req.body.thread_id,
      language: req.body.language,
      tone: req.body.tone,
      instruction: req.body.instruction,
    }, actor(req))),
  })));

router.post("/assist/rewrite", requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    text: z.string().min(1).max(20000),
    action: ACTION,
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.rewrite(c, {
      threadId: req.body.thread_id, text: req.body.text,
      action: req.body.action, language: req.body.language,
    }, actor(req))),
  })));

router.post("/assist/translate", requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    text: z.string().min(1).max(20000),
    to: z.enum(["en", "fr"]),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.translate(c, {
      threadId: req.body.thread_id, text: req.body.text,
      to: req.body.to, language: req.body.language,
    }, actor(req))),
  })));

/**
 * Summaries are a POST even though they read, because a cache miss GENERATES —
 * it spends money and writes `email_thread_summary`. A GET that can bill the
 * tenant is a GET a proxy, a prefetcher or a retry will bill them for twice.
 */
router.post("/assist/summary", requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid(),
    language: z.enum(["en", "fr"]).optional(),
    force: z.boolean().optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.summary(c, {
      threadId: req.body.thread_id, language: req.body.language, force: req.body.force,
    }, actor(req))),
  })));

/**
 * Voice takes the TRANSCRIPT, not the audio — see the note in
 * `assist.service.voice`. The product already owns speech-to-text in
 * `jobs/handlers/ai-transcribe.js`, metered against its own feature, and a
 * second transcription path in the mail module would be a second thing to keep
 * configured and the first to break.
 */
router.post("/assist/voice", requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    transcript: z.string().min(1).max(20000),
    tone: TONE.optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.voice(c, {
      threadId: req.body.thread_id, transcript: req.body.transcript,
      tone: req.body.tone, language: req.body.language,
    }, actor(req))),
  })));

/**
 * The pre-send check, exposed so the composer can show the bar BEFORE the user
 * presses send. It is advisory here on purpose: the authoritative run is inside
 * `outbox.service.send` (see `mail/presend.js`), which is what makes the block
 * a block rather than a suggestion a client may decline to request.
 */
router.post("/assist/guardrails", requirePermission("MOD-72", "view"),
  body(z.object({
    html: z.string().max(200000).optional(),
    text: z.string().max(200000).optional(),
    subject: z.string().max(998).optional(),
    to: z.array(z.string()).max(50).optional(),
    attachments: z.array(z.object({ filename: z.string().max(500).optional() }).strict()).max(50).optional(),
    htmlBytes: z.number().optional(),
    ctx: z.record(z.unknown()).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({ data: service.runGuardrails(req.body, req.body.ctx || {}) })));

/**
 * Search by meaning (§8.9) — the toggle beside keyword search.
 *
 * The caller is passed through because the vector hits are only CANDIDATES:
 * `semantic.search` re-reads every one through `triage/visibility`'s single
 * §9.5 predicate before returning it. The embedding layer never decides who
 * sees a thread.
 */
router.post("/assist/search", requirePermission("MOD-72", "view"),
  body(z.object({
    query: z.string().min(2).max(500),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => semantic.search(c, {
      query: req.body.query,
      userId: req.user && req.user.user_id,
      limit: req.body.limit || 10,
    })),
  })));

/* ── OCR staging (§8.6) ────────────────────────────────────────────────────
 *
 * TWO gates, not one. `mail.ai` is already on the router — it is the floor for
 * every AI surface in the mailbox — and `mail.ocr` narrows it further, because
 * drafting sends a thread's TEXT to a language model while extraction sends a
 * scanned supplier invoice, bank details and all, to a VISION vendor. A tenant
 * is entitled to want the first and refuse the second, and one flag for both
 * removes that choice.
 *
 * The read routes carry it too. A pending-extractions list is a list of what we
 * have already sent to that vendor, and a tenant who has the feature off should
 * not be shown a screen implying otherwise. */
const requireOcr = requireFeature("mail.ocr");

router.post("/assist/ocr/:attachmentId", requireOcr, requirePermission("MOD-72", "view"),
  body(z.object({ force: z.boolean().optional() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.extract(c, {
      attachmentId: req.params.attachmentId, force: req.body.force,
    }, actor(req))),
  })));

router.get("/assist/ocr/pending", requireOcr, requirePermission("MOD-72", "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.listPending(c, { limit: Number(req.query.limit) || 50 })),
  })));

router.get("/messages/:id/extractions", requireOcr, requirePermission("MOD-72", "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.listForMessage(c, req.params.id)),
  })));

/**
 * Review records the human's reading over the machine's and stops there. The
 * business record is created in the owning module, from a form prefilled with
 * these fields — §8.6 is explicit that extraction never writes one, and
 * `edit` rather than `create` is the right permission because nothing is
 * created here.
 */
router.post("/assist/extractions/:id/review", requireOcr, requirePermission("MOD-72", "edit"),
  body(z.object({ fields: z.record(z.unknown()).nullable().optional() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.review(c, req.params.id, { fields: req.body.fields }, actor(req))),
  })));

/**
 * Dismiss carries no body, so it had no validator — and `:id` went to the
 * repo unchecked. A path parameter is request input like any other; an
 * unparseable one should be a 422 naming the field, not a 500 out of the
 * driver on a malformed uuid.
 */
router.post("/assist/extractions/:id/dismiss", requireOcr, requirePermission("MOD-72", "edit"),
  params(z.object({ id: z.string().uuid() })),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.dismiss(c, req.params.id, actor(req))),
  })));

module.exports = { basePath: "/mail", feature: null, router };
