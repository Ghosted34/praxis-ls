/**
 * The AI surface (§8.11).
 *
 * Three things about this file are load-bearing and easy to undo by accident.
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
 *
 * 3. THE `mail.ai` GATE IS A PER-ROUTE MIDDLEWARE — NEVER A `router.use` ON
 *    THIS ROUTER. This module mounts at /mail, the same base path as
 *    mail/mail, mail/binding, mail/triage and the rest, and the module loader
 *    discovers them alphabetically: this router is the first /mail a request
 *    meets. A router-level `router.use(requireFeature("mail.ai"))` therefore
 *    ran for every /mail/* request that fell through to it — with AI off (the
 *    flag's default) it answered FEATURE_DISABLED for GET /mail/threads,
 *    GET /mail/folders and GET /mail/mailboxes/mine before they ever reached
 *    mail.routes.js. The whole inbox was unreachable for every tenant that
 *    had not opted into AI, while the Platform Console correctly showed
 *    "Mail AI: off". The gate is applied to each /assist/* route below; a
 *    route added without it fails the test in
 *    tests/security/mail-ai-gate-scope.test.js, not the customer's inbox.
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
/*
 * C-4, this chapter's contribution. `assist.service.threadContext` and
 * `threadMessages` query `email_thread` / `email_message` BY ID with no §9.5
 * predicate, so a caller who knew (or guessed from a deep link) a thread id
 * could POST /assist/draft and receive a generated reply built from a PRIVATE
 * thread's transcript plus the ERP facts of its bound entity — and /assist/
 * summary additionally WROTE that transcript-derived text into
 * `email_thread_summary`, where the same unscoped SELECT served it back on
 * every later call.
 *
 * The OCR route was worse in kind: it resolved an arbitrary attachment id, read
 * the vault bytes and sent them to an external VISION vendor. An ungated id
 * there did not merely disclose a private thread's file, it exported it to a
 * third party — a supplier invoice's bank details leaving the building.
 *
 * The route's own header (note 1 above) is about grounding RBAC, which was
 * correctly implemented. The visibility question was simply never asked of
 * these routes; these three middlewares ask it.
 */
const {
  requireVisibleThreadBody,
  requireVisibleMessage,
  requireVisibleAttachment,
  requireVisibleExtraction,
} = require("../mail/visible");

const router = express.Router();
router.use(authMiddleware);

/**
 * The AI gate (note 3 in the header): per route, on every /assist/* route
 * below — the AI surface, and nothing else in this module.
 *
 * It was once one line, one scope wider than it should have been:
 * `router.use(requireFeature("mail.ai"))` directly on `router`. Because this
 * module mounts at /mail — the same base path as mail/mail (the inbox,
 * folders and mailbox setup), and the first /mail router the module loader
 * mounts — that router-level gate ran for every /mail/* request that fell
 * through to it. With AI off, its default, the gate answered
 * FEATURE_DISABLED for GET /mail/threads, GET /mail/folders and
 * GET /mail/mailboxes/mine before they reached mail.routes.js, and the inbox
 * was down for every tenant that had not opted into AI.
 */
const requireAi = requireFeature("mail.ai");

/** See note 1 in the header. */
const actor = (req) => req.user || null;

const TONE = z.enum([
  "formal", "friendly", "concise", "persuasive", "apologetic",
  "payment", "escalation", "technical", "followup", "notice",
]);
const ACTION = z.enum(["grammar", "shorten", "expand", "to_fr", "to_en"]);

router.post("/assist/compose", requireAi, requirePermission("MOD-72", "view"),
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
  requireVisibleThreadBody("thread_id", { optional: true }),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.compose(c, req.body, actor(req))),
  })));

router.post("/assist/draft", requireAi, requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid(),
    language: z.enum(["en", "fr"]).optional(),
    tone: TONE.optional(),
    instruction: z.string().max(2000).optional(),
  }).strict()),
  requireVisibleThreadBody("thread_id"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.draft(c, {
      threadId: req.body.thread_id,
      language: req.body.language,
      tone: req.body.tone,
      instruction: req.body.instruction,
    }, actor(req))),
  })));

router.post("/assist/rewrite", requireAi, requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    text: z.string().min(1).max(20000),
    action: ACTION,
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  requireVisibleThreadBody("thread_id", { optional: true }),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.rewrite(c, {
      threadId: req.body.thread_id, text: req.body.text,
      action: req.body.action, language: req.body.language,
    }, actor(req))),
  })));

router.post("/assist/translate", requireAi, requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    text: z.string().min(1).max(20000),
    to: z.enum(["en", "fr"]),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  requireVisibleThreadBody("thread_id", { optional: true }),
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
router.post("/assist/summary", requireAi, requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid(),
    language: z.enum(["en", "fr"]).optional(),
    force: z.boolean().optional(),
  }).strict()),
  requireVisibleThreadBody("thread_id"),
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
router.post("/assist/voice", requireAi, requirePermission("MOD-72", "view"),
  body(z.object({
    thread_id: z.string().uuid().optional(),
    transcript: z.string().min(1).max(20000),
    tone: TONE.optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  requireVisibleThreadBody("thread_id", { optional: true }),
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
router.post("/assist/guardrails", requireAi, requirePermission("MOD-72", "view"),
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
router.post("/assist/search", requireAi, requirePermission("MOD-72", "view"),
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
 * TWO gates, not one. `mail.ai` (requireAi, note 3 in the header) is the
 * floor for every AI surface in the mailbox — and `mail.ocr` narrows it
 * further, because
 * drafting sends a thread's TEXT to a language model while extraction sends a
 * scanned supplier invoice, bank details and all, to a VISION vendor. A tenant
 * is entitled to want the first and refuse the second, and one flag for both
 * removes that choice.
 *
 * The read routes carry it too. A pending-extractions list is a list of what we
 * have already sent to that vendor, and a tenant who has the feature off should
 * not be shown a screen implying otherwise. */
const requireOcr = requireFeature("mail.ocr");

router.post("/assist/ocr/:attachmentId", requireAi, requireOcr, requirePermission("MOD-72", "view"),
  body(z.object({ force: z.boolean().optional() }).strict()),
  requireVisibleAttachment("attachmentId"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.extract(c, {
      attachmentId: req.params.attachmentId, force: req.body.force,
    }, actor(req))),
  })));

/* Tenant-wide before C-4: this is a list of what has ALREADY been sent to the
 * vision vendor, keyed to attachments, and it named threads the caller could
 * not open. It is now filtered by the same §9.5 predicate as everything else —
 * in the service, because a middleware cannot narrow a list it does not build. */
router.get("/assist/ocr/pending", requireAi, requireOcr, requirePermission("MOD-72", "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.listPending(c, {
      limit: Number(req.query.limit) || 50,
      userId: (req.user && req.user.user_id) || null,
    })),
  })));

/* Outside /assist on purpose: the AI gate is scoped to the AI surface (note 3
 * in the header), and this read route's own gate is mail.ocr. That is not a
 * loss of the AI floor — the catalogue row for mail.ocr depends on mail.ai
 * (9114), so the projection cannot enable it without the AI flag already on.
 */
router.get("/messages/:id/extractions", requireOcr, requirePermission("MOD-72", "view"), requireVisibleMessage("id"),
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
router.post("/assist/extractions/:id/review", requireAi, requireOcr, requirePermission("MOD-72", "edit"), requireVisibleExtraction(),
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
router.post("/assist/extractions/:id/dismiss", requireAi, requireOcr, requirePermission("MOD-72", "edit"), requireVisibleExtraction(),
  params(z.object({ id: z.string().uuid() })),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => ocr.dismiss(c, req.params.id, actor(req))),
  })));

module.exports = { basePath: "/mail", feature: null, router };
