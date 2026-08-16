/** Appraisal routes — RBAC-gated (MOD-13) + feature "hr.appraisals". */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./appraisal.controller");
const validator = require("./appraisal.validator");

const M = "MOD-13";
const router = express.Router();
router.use(authMiddleware);

// Self-service — the caller's own appraisals (My HR). No MOD grant.
router.get("/mine", controller.mine);
/* The caller's own REVIEW, and their answer to it (0701).
 *
 * No MOD grant, and that is the point of the whole feature: a performance
 * record that may later justify a dismissal must be readable by the person it
 * is about. `mine` only ever returns reviews from a RELEASED cycle, and
 * `respond` checks the review belongs to the caller — a 404, not a 403, since
 * telling somebody that another employee's review exists is itself a
 * disclosure. */
router.get("/reviews/mine", controller.myReviews);
router.post("/reviews/:reviewId/respond", validator.reviewRespond, controller.respondToReview);

/* ── Cycles ────────────────────────────────────────────────────────────────
 *
 * Reading a cycle and its reviews is `view`. Creating one and moving it through
 * its states is `approve`, not `edit`: RELEASED is the moment every employee in
 * the company can read their appraisal, and CLOSED ends the round. Neither is
 * an edit to a record.
 *
 * SCORING is `edit` — it writes evidence-derived suggestions and never touches
 * a rating a human has decided, so it is safe in the hands of whoever runs the
 * round. Declared before `/:id` so `/cycles` is not read as an appraisal id. */
router.get("/cycles", requirePermission(M, "view"), controller.listCycles);
router.post("/cycles", requirePermission(M, "approve"), validator.cycle, controller.createCycle);
router.post("/cycles/:cycleId/status", requirePermission(M, "approve"), validator.cycleStatus, controller.setCycleStatus);
router.post("/cycles/:cycleId/score", requirePermission(M, "edit"), validator.scoreRun, controller.scoreCycle);
router.post("/cycles/:cycleId/reviews", requirePermission(M, "edit"), validator.reviewOpen, controller.openReview);

router.get("/reviews", requirePermission(M, "view"), controller.listReviews);
router.get("/reviews/:reviewId", requirePermission(M, "view"), controller.getReview);
router.post("/reviews/:reviewId/submit", requirePermission(M, "edit"), validator.reviewSubmit, controller.submitReview);
router.post("/reviews/:reviewId/narrate", requirePermission(M, "edit"), controller.narrateReview);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/reward", requirePermission(M, "approve"), validator.reward, controller.reward);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/appraisals", feature: "hr.appraisals", router };
