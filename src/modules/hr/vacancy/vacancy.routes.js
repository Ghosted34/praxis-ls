/** Vacancy routes — RBAC-gated (MOD-11) + feature "hr.recruitment".
 * Vacancy lifecycle DRAFT → OPEN ⇄ PAUSED → CLOSED via POST /:id/status.
 * Applicants: GET/POST /:id/applicants, PATCH /:id/applicants/:applicantId. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./vacancy.controller");
const validator = require("./vacancy.validator");

const M = "MOD-11";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  DRAFT: "edit",
  OPEN: "edit",
  // Pausing and resuming are `edit`: both are reversible, neither ends the
  // record, and the public link survives them (0682). Closing stays `approve`.
  PAUSED: "edit",
  CLOSED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
// Literal paths BEFORE /:id, or `/talent-pool` is read as a vacancy id and the
// id guard rejects it as a malformed uuid.
router.get("/talent-pool", requirePermission(M, "view"), controller.searchPool);

/* ── The drafting interview (0526) ────────────────────────────────────────
 *
 * "New vacancy" is an interview, not a form: the recruiter answers a handful of
 * questions and the model writes the advert, infers the department and
 * employment type and proposes a salary band, grounded in the hiring corporate
 * entity.
 *
 * `/intake/questions` is `view` — it returns a static list and the entity's
 * currency, and gating a question set behind `create` would mean a recruiter
 * could not see what they were about to be asked.
 *
 * `/intake/follow-ups` and `/draft` are `create`: both spend a model call
 * against the tenant's AI budget, and `/draft` inserts a DRAFT vacancy — the
 * work has to survive a closed tab after a four-minute interview, so it is
 * saved rather than previewed.
 */
/* Which companies a vacancy can be opened under. `view`, and on THIS module
 * rather than the corporate-entity module, because a recruiter who can post a
 * role is not necessarily granted the master-data list — and a create form that
 * cannot name the employer produces vacancies attached to nobody. */
router.get("/hiring-entities", requirePermission(M, "view"), controller.hiringEntities);
router.get("/intake/questions", requirePermission(M, "view"), controller.intakeQuestions);
router.post("/intake/follow-ups", requirePermission(M, "create"), validator.intake, controller.intakeFollowUps);
router.post("/draft", requirePermission(M, "create"), validator.intake, controller.draftVacancy);
/* Voice answers. Lives here rather than on the AI module because the intake
 * wizard is its only caller today and a general `/ai/transcribe` would need a
 * permission model of its own; when the second caller appears (an applicant's
 * covering note, a meeting note) it should move and this should become a
 * re-export rather than a copy. */
router.post("/intake/transcribe", requirePermission(M, "create"), validator.transcribe, controller.transcribe);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/applicants", requirePermission(M, "view"), controller.listApplicants);

/* ── AI scoring, criteria, questions, scorecard, publishing (0525) ──────────
 *
 * The permission each one takes is the interesting part:
 *
 *   SCORING is `edit`, not `view`. It writes to the applicant row and it spends
 *   a model call against the tenant's AI budget — a read-only grant must not be
 *   able to run either.
 *
 *   CRITERIA and QUESTIONS are `edit`: they change what every future candidate
 *   for this role is measured and asked against, which is a change to the
 *   process, not to one record.
 *
 *   RATING is `edit` as well. Interviewing is not a spectator activity, and the
 *   scorecard is what a hiring decision is later defended with.
 *
 *   PUBLISHING is `approve` — the only action here that puts something on the
 *   public internet under the company's name, and the only one that cannot be
 *   quietly undone (unpublishing mints a new token, so the old links are gone
 *   for good).
 */
router.post("/:id/applicants/:applicantId/score", requirePermission(M, "edit"), controller.scoreApplicant);

router.get("/:id/criteria", requirePermission(M, "view"), controller.listCriteria);
router.post("/:id/criteria", requirePermission(M, "edit"), validator.criterion, controller.addCriterion);
router.delete("/:id/criteria/:criterionId", requirePermission(M, "edit"), controller.removeCriterion);

router.get("/:id/questions", requirePermission(M, "view"), controller.listQuestions);
router.post("/:id/questions", requirePermission(M, "edit"), validator.question, controller.addQuestion);
router.post("/:id/questions/generate", requirePermission(M, "edit"), controller.generateQuestions);
router.delete("/:id/questions/:questionId", requirePermission(M, "edit"), controller.removeQuestion);

router.get("/:id/applicants/:applicantId/answers", requirePermission(M, "view"), controller.listAnswers);
router.post("/:id/applicants/:applicantId/answers", requirePermission(M, "edit"), validator.answer, controller.rateAnswer);

router.post("/:id/publish", requirePermission(M, "approve"), validator.publish, controller.setPublished);
router.post("/:id/applicants", requirePermission(M, "edit"), validator.applicant, controller.addApplicant);
router.patch("/:id/applicants/:applicantId", requirePermission(M, "edit"), validator.applicantStatus, controller.setApplicantStatus);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/vacancies", feature: "hr.recruitment", router };
