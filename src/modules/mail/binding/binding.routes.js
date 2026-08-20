"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { z } = require("zod");
const binding = require("./binding.service");
const context = require("./mail-context.service");
const notes = require("./notes.service");
const cards = require("./cards");
const convert = require("./convert.service");

const M = "MOD-72";
const router = express.Router();
router.use(authMiddleware);

const actor = (req) => req.user || { user_id: null };
const parse = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

router.get("/threads/:id/suggestions", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.list(c, req.params.id)) })));
router.post("/threads/:id/suggestions/:sid/accept", requireFeature("mail.binding"), requirePermission(M, "edit"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.accept(c, { threadId: req.params.id, suggestionId: req.params.sid, actor: actor(req) })) })));
router.post("/threads/:id/suggestions/:sid/reject", requireFeature("mail.binding"), requirePermission(M, "edit"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.reject(c, { threadId: req.params.id, suggestionId: req.params.sid, actor: actor(req) })) })));
router.post("/threads/:id/bind", requireFeature("mail.binding"), requirePermission(M, "edit"),
  parse(z.object({ entity_ref: z.string().trim().min(3).max(128) }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.bind(c, { threadId: req.params.id, entityRef: req.body.entity_ref, actor: actor(req) })) })));
router.delete("/threads/:id/bind", requireFeature("mail.binding"), requirePermission(M, "edit"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.unbind(c, { threadId: req.params.id, actor: actor(req) })) })));
router.post("/suggestions/accept-batch", requireFeature("mail.binding"), requirePermission(M, "edit"),
  parse(z.object({ thread_ids: z.array(z.string().uuid()).min(1).max(200), min_confidence: z.coerce.number().min(0).max(1).optional() }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => binding.acceptBatch(c, { threadIds: req.body.thread_ids, minConfidence: req.body.min_confidence, actor: actor(req) })) })));

router.get("/context", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => context.overview(c, req.query.entity_ref, { userId: actor(req).user_id })) })));
router.get("/context/:tab", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => context.tab(c, req.query.entity_ref, req.params.tab, { userId: actor(req).user_id })) })));

router.get("/threads/:id/cards/:card/readiness", requireFeature("mail.binding"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => cards.readiness(c, req.params.id, req.params.card)) })));

router.get("/threads/:id/notes", requireFeature("mail.notes"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => notes.list(c, req.params.id)) })));
router.post("/threads/:id/notes", requireFeature("mail.notes"), requirePermission(M, "create"),
  parse(z.object({ body: z.string().trim().min(1).max(20000), mentions: z.array(z.string().uuid()).max(20).optional() }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => notes.create(c, { threadId: req.params.id, body: req.body.body, mentions: req.body.mentions, actor: actor(req) })) })));

router.post("/threads/:id/convert", requireFeature("mail.binding"), requirePermission(M, "create"),
  parse(z.object({ target: z.enum(["lead", "quote_request", "enquiry", "ticket", "task", "purchase_requisition"]) }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => convert.preview(c, req.params.id, req.body.target)) })));

module.exports = { basePath: "/mail", feature: null, router };
