/**
 * Error Command Center routes (spec §6).
 *
 * Mounted by platform.routes.js UNDER the existing `platformAuth`, so every
 * route here already has an authenticated platform user and req.platformCaps.
 *
 * CAPABILITY TIERS (§4.3)
 *   errors.read      — see the feed, detail, stats, trends, export, share
 *   errors.resolve   — mark resolved / reopen
 *   errors.configure — escalation rules
 *
 * ROUTE ORDER MATTERS. `/errors/recent`, `/errors/stats`, `/errors/trends` and
 * `/errors/modules` are declared BEFORE `/errors/:id`. Express matches in
 * declaration order, so with `:id` first, `GET /errors/stats` binds id="stats",
 * fails the uuid guard and 422s — a bug that looks like a broken dashboard and
 * is genuinely annoying to trace.
 *
 * AI EXPLAIN IS RATE LIMITED (§11, 10 req/min per user). It spends real money
 * per call against a third-party provider, so an un-limited endpoint is a
 * billing incident waiting to happen — the Redis cache in front of it only
 * helps for signatures already explained.
 */
"use strict";

const express = require("express");
const c = require("./errors.controller");
const { validateQuery, validateBody, validateParams } = require("./errors.validator");
const { requireCap } = require("../../../middleware/platform-auth");
const { makeLimiter } = require("../../../shared/http/rate-limit");

const router = express.Router();

const explainLimiter = makeLimiter({ name: "error-explain", max: 10, windowMs: 60_000 });

// ── Collection reads ────────────────────────────────────────────────────────
router.get("/errors", requireCap("errors.read"), validateQuery("errorList"), c.list);
router.get("/errors/recent", requireCap("errors.read"), validateQuery("errorRecent"), c.recent);
router.get("/errors/stats", requireCap("errors.read"), validateQuery("errorList"), c.stats);
router.get("/errors/trends", requireCap("errors.read"), validateQuery("errorTrends"), c.trends);
router.get("/errors/modules", requireCap("errors.read"), c.modules);
router.get("/errors/export", requireCap("errors.read"), validateQuery("errorList"), c.exportErrors);

// ── Escalation rules (§5) — before /errors/:id for the same reason. ──────────
router.get("/escalation/rules", requireCap("errors.read"), c.rulesList);
router.post("/escalation/rules", requireCap("errors.configure"), validateBody("ruleCreate"), c.ruleCreate);
router.post("/escalation/rules/preview", requireCap("errors.configure"), validateBody("rulePreview"), c.rulePreview);
router.get("/escalation/log", requireCap("errors.read"), validateQuery("escalationLog"), c.ruleLog);
router.put("/escalation/rules/:id", requireCap("errors.configure"), validateBody("ruleUpdate"), c.ruleUpdate);
router.patch("/escalation/rules/:id", requireCap("errors.configure"), validateBody("ruleUpdate"), c.ruleUpdate);
router.delete("/escalation/rules/:id", requireCap("errors.configure"), c.ruleDelete);

// ── Single error ────────────────────────────────────────────────────────────
router.get("/errors/:id", requireCap("errors.read"), validateParams("errorId"), c.get);
router.get("/errors/:id/share", requireCap("errors.read"), validateParams("errorId"), c.shareTargets);
router.post(
  "/errors/:id/explain",
  requireCap("errors.read"),
  explainLimiter,
  validateParams("errorId"),
  validateBody("explain"),
  c.explain,
);
router.post("/errors/:id/resolve", requireCap("errors.resolve"), validateParams("errorId"), c.resolve);
router.post("/errors/:id/reopen", requireCap("errors.resolve"), validateParams("errorId"), c.reopen);

module.exports = router;
