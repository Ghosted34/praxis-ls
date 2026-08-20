"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler } = require("../../../utils/errors");
const { z } = require("zod");
const { body } = require("../../../shared/http/validate");
const service = require("./assist.service");

const router = express.Router();
router.use(authMiddleware);
router.use(requireFeature("mail.ai"));

router.post("/assist/compose", requirePermission("MOD-72", "view"),
  body(z.object({
    mode: z.string().optional(),
    tone: z.string().optional(),
    action: z.string().optional(),
    thread_id: z.string().uuid().optional(),
    draft: z.string().max(20000).optional(),
    language: z.enum(["en", "fr"]).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.compose(c, req.body)) })));

router.post("/assist/draft", requirePermission("MOD-72", "view"),
  body(z.object({ thread_id: z.string().uuid(), language: z.enum(["en", "fr"]).optional(), tone: z.string().optional() }).strict()),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.draft(c, { threadId: req.body.thread_id, language: req.body.language, tone: req.body.tone })) })));

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

module.exports = { basePath: "/mail", feature: null, router };
