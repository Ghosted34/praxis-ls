/**
 * Was bare makeRouter() with no auth/RBAC gating — a pre-existing gap noted
 * in doc/RBAC_SECURITY_KICKOFF.md and doc/WORK_TO_BE_DONE.md. Gated here
 * following capability.routes.js's pattern; role sits under the same
 * MOD-67 (IAM/RBAC engine) grant as capability/scope/permission/
 * field_visibility — one module_key covers the whole IAM screen group.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./iam_role.controller");
const validator = require("./iam_role.validator");
const kpiController = require("../role_kpi/role_kpi.controller");
const { validateKpiConfig } = require("../role_kpi/role_kpi.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

/**
 * The Control Tower band for a role (doc/KPI_BAND_ENGINEERING_GUIDE.md §7.2).
 *
 * A two-segment path (`/:id/kpi`), so `/:id` can never swallow it, and gated
 * one notch BELOW the grant matrix on purpose: the matrix is `approve`

 * because editing WHO can do things is the highest-leverage write in the
 * system; a role's band edits what a role is SHOWN of what it may already
 * read, which is `edit` — the same bar as the role's own name. A tile can
 * never outlive its module grant (eligibility filters every read), so this
 * write cannot raise anyone's ceiling.
 */
router.get("/:id/kpi", requirePermission(MODULE, "view"), kpiController.get);
router.put("/:id/kpi", requirePermission(MODULE, "edit"), validateKpiConfig, kpiController.put);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/roles", feature: null, router };
