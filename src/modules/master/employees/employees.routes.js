/** Employee master (MOD-02). RBAC-gated; foundational master data (no feature flag). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./employees.controller");
const validator = require("./employees.validator");

const MODULE = "MOD-02";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
// Self-service, declared BEFORE `/:id` — "mine" is a valid uuid-shaped path
// segment as far as express is concerned, so the id route would otherwise
// swallow it and answer with a 404 for an employee called "mine".
//
// These take NO grant, matching attendance's `/mine` pair: a person is entitled
// to see and correct their own contact details, and requiring MOD-02 view would
// mean handing every member of staff the whole roster, salaries included, to
// let them fix their own phone number.
router.get("/mine", controller.mine);
router.patch("/mine", validator.updateMine, controller.updateMine);

router.get("/roster", requirePermission(MODULE, "view"), controller.roster);
router.get("/drivers", requirePermission(MODULE, "view"), controller.drivers);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/references", requirePermission(MODULE, "view"), controller.references);
// Reporting line (0493): direct reports, the whole team beneath someone, and the
// chain of managers above them — the escalation path W13 will read.
router.get("/:id/reports", requirePermission(MODULE, "view"), controller.reports);
router.get("/:id/team", requirePermission(MODULE, "view"), controller.team);
router.get("/:id/managers", requirePermission(MODULE, "view"), controller.managers);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/employees", feature: null, router };
