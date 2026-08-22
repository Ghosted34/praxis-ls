"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler } = require("../../../utils/errors");
const { z } = require("zod");
const { body } = require("../../../shared/http/validate");
const binding = require("./binding.service");
const context = require("./mail-context.service");
const notes = require("./notes.service");
const cards = require("./cards");
const convert = require("./convert.service");
const intake = require("./intake.service");
// C-4. Every thread-scoped route in this file previously ran with no §9.5
// check at route OR service level: internal notes readable and writable, a
// Private thread bindable to an ERP entity (a CRM-timeline write), cards
// exposing subject, participants, bound client and payment terms. The gate is
// applied per route rather than `router.use`d, because this file also carries
// routes that are entity-scoped rather than thread-scoped and those need a
// different answer, not a skipped one.
const {
  requireVisibleThread,
  restrictThreadIdsBody,
} = require("../mail/visible");

const M = "MOD-72";
const router = express.Router();
router.use(authMiddleware);

const actor = (req) => req.user || { user_id: null };

router.get("/threads/:id/suggestions", requireFeature("mail.binding"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.list(c, req.params.id)) })));
router.post("/threads/:id/suggestions/:sid/accept", requireFeature("mail.binding"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.accept(c, { threadId: req.params.id, suggestionId: req.params.sid, actor: actor(req) })) })));
router.post("/threads/:id/suggestions/:sid/reject", requireFeature("mail.binding"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.reject(c, { threadId: req.params.id, suggestionId: req.params.sid, actor: actor(req) })) })));
router.post("/threads/:id/bind", requireFeature("mail.binding"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ entity_ref: z.string().trim().min(3).max(128) }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.bind(c, { threadId: req.params.id, entityRef: req.body.entity_ref, actor: actor(req) })) })));
router.delete("/threads/:id/bind", requireFeature("mail.binding"), requirePermission(M, "edit"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.unbind(c, { threadId: req.params.id, actor: actor(req) })) })));
/* Up to 200 thread ids in one call. `restrictThreadIdsBody` narrows the list to
 * the threads the caller may actually see BEFORE the service runs, and reports
 * how many were dropped — narrowing rather than refusing, so the endpoint
 * cannot be walked as an existence oracle, and reported rather than silent, so
 * it is a stated limit and not a quiet cap. */
router.post("/suggestions/accept-batch", requireFeature("mail.binding"), requirePermission(M, "edit"),
  body(z.object({ thread_ids: z.array(z.string().uuid()).min(1).max(200), min_confidence: z.coerce.number().min(0).max(1).optional() }).strict()),
  restrictThreadIdsBody("thread_ids"),
  asyncHandler(async (req, res) => {
    const out = req.body.thread_ids.length
      ? await req.identityDb((c) => binding.acceptBatch(c, { threadIds: req.body.thread_ids, minConfidence: req.body.min_confidence, actor: actor(req) }))
      : { accepted: 0, results: [] };
    res.json({ data: { ...out, not_visible: req.mailThreadIdsDropped || 0 } });
  }));

router.get("/context", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => context.overview(c, req.query.entity_ref, { userId: actor(req).user_id, user: req.user })) })));
router.get("/context/:tab", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => context.tab(c, req.query.entity_ref, req.params.tab, { userId: actor(req).user_id, user: req.user })) })));

/* Every card that applies to this thread, with its readiness — ONE query, so
 * the reading pane draws the whole strip without spending the §3.6 budget. */
router.get("/threads/:id/cards", requireFeature("mail.binding"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => cards.forThread(c, req.params.id)) })));

router.get("/threads/:id/cards/:card/readiness", requireFeature("mail.binding"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => cards.readiness(c, req.params.id, req.params.card)) })));

router.get("/threads/:id/notes", requireFeature("mail.notes"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => notes.list(c, req.params.id)) })));
router.post("/threads/:id/notes", requireFeature("mail.notes"), requirePermission(M, "create"), requireVisibleThread(),
  body(z.object({ body: z.string().trim().min(1).max(20000), mentions: z.array(z.string().uuid()).max(20).optional() }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => notes.create(c, { threadId: req.params.id, body: req.body.body, mentions: req.body.mentions, actor: actor(req) })) })));

/* Preview only — Q23 "always confirm". The record is created by the TARGET
 * module, under its own rights, from the form the user reviews. */
router.post("/threads/:id/convert", requireFeature("mail.binding"), requirePermission(M, "create"), requireVisibleThread(),
  body(z.object({ target: z.enum(["lead", "quote_request", "enquiry", "ticket", "task", "purchase_requisition"]) }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => convert.preview(c, req.params.id, req.body.target)) })));

/* The other half of §7.7's "bidirectional in the record": the target module
 * calls this once it has created something, and the thread shows what it
 * became. Only mail's own columns are written here. */
router.post("/threads/:id/converted", requireFeature("mail.binding"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ entity_ref: z.string().trim().min(3).max(128) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => convert.recordConversion(c, req.params.id, req.body.entity_ref, actor(req))),
  })));

/* ── Inbound document intake (§7.6) ─────────────────────────────────────────
 *
 * `mail.doc_intake` gates the whole surface. Filing goes to MOD-64 `create`,
 * not MOD-72 — §3.4: "the vault owns the document", so the right to put
 * something in it is the vault's to grant, not mail's. */
router.get("/threads/:id/intake", requireFeature("mail.doc_intake"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => intake.listForThread(c, req.params.id)) })));

router.post("/intake/:id/file", requireFeature("mail.doc_intake"), requirePermission("MOD-64", "create"),
  body(z.object({
    doc_type_code: z.string().trim().max(64).optional(),
    entity_ref: z.string().trim().max(128).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => intake.accept(c, req.params.id, {
      docTypeCode: req.body.doc_type_code || null,
      entityRef: req.body.entity_ref || null,
    }, actor(req))),
  })));

router.post("/intake/:id/reject", requireFeature("mail.doc_intake"), requirePermission(M, "edit"),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => intake.reject(c, req.params.id, actor(req))),
  })));

/* What the "Chase missing documents" composer opens prefilled with — exactly
 * the outstanding items, in the client's language. A chase listing documents
 * the client already sent is worse than no chase: it says nobody looked. */
/* P3-2: this one is CLIENT-scoped, not thread-scoped, so the thread predicate
 * has nothing to bite on. It is gated by MOD-72 view alone, which means the
 * outstanding-document list for any client id is readable by any mail user —
 * the same standing question as P3-1 (per-source RBAC on the dossier drawer),
 * and it wants the same answer. Recorded rather than silently gated with a
 * predicate that would not mean anything here. */
router.get("/intake/chase/:clientId", requireFeature("mail.doc_intake"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => intake.chaseList(c, req.params.clientId)) })));

module.exports = { basePath: "/mail", feature: null, router };
