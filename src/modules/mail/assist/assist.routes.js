"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { z } = require("zod");
const service = require("./assist.service");

const router = express.Router();
router.use(authMiddleware);
router.use(requireFeature("mail.ai"));

const parse = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

router.post("/assist/compose", requirePermission("MOD-72", "view"),
  parse(z.object({
    mode: z.string().optional(),
    tone: z.string().optional(),
    action: z.string().optional(),
    thread_id: z.string().uuid().optional(),
    draft: z.string().max(20000).optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.compose(c, req.body)) })));

router.post("/assist/draft", requirePermission("MOD-72", "view"),
  parse(z.object({ thread_id: z.string().uuid(), language: z.enum(["en", "fr"]).optional(), tone: z.string().optional() }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.draft(c, { threadId: req.body.thread_id, language: req.body.language, tone: req.body.tone })) })));

router.post("/assist/guardrails", requirePermission("MOD-72", "view"),
  asyncHandler(async (req, res) => res.json({ data: service.runGuardrails(req.body || {}, req.body && req.body.ctx || {}) })));

module.exports = { basePath: "/mail", feature: null, router };
