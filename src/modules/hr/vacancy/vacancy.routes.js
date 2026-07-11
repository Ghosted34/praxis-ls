/** Vacancy routes — RBAC-gated (MOD-11) + feature "hr.recruitment".
 * Vacancy lifecycle DRAFT → OPEN → CLOSED via POST /:id/status.
 * Applicants: GET/POST /:id/applicants, PATCH /:id/applicants/:applicantId. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./vacancy.controller");
const validator = require("./vacancy.validator");

const M = "MOD-11";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/applicants", requirePermission(M, "view"), controller.listApplicants);
router.post("/:id/applicants", requirePermission(M, "edit"), validator.applicant, controller.addApplicant);
router.patch("/:id/applicants/:applicantId", requirePermission(M, "edit"), validator.applicantStatus, controller.setApplicantStatus);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/vacancies", feature: "hr.recruitment", router };
