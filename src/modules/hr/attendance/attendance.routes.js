/** Attendance routes — RBAC-gated (MOD-14) + feature "hr".
 *  Geofenced self-service time clock (clock-in/out with GPS) + worksite geofence
 *  management + the admin log. Specific paths precede /:id so they aren't shadowed. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./attendance.controller");
const validator = require("./attendance.validator");

const M = "MOD-14";
const view = requirePermission(M, "view");
const create = requirePermission(M, "create");
const edit = requirePermission(M, "edit");
const del = requirePermission(M, "delete");

const router = express.Router();
router.use(authMiddleware);

// Self-service time clock
router.get("/open", view, controller.open);
router.post("/clock-in", create, validator.clockIn, controller.clockIn);
router.post("/clock-out", create, validator.clockOut, controller.clockOut);

// Manager view — absences for a day
router.get("/absence", view, controller.absence);

// Worksites (geofence centres)
router.get("/work-sites", view, controller.listSites);
router.post("/work-sites", edit, validator.workSite, controller.createSite);
router.patch("/work-sites/:siteId", edit, validator.workSiteUpdate, controller.updateSite);

// Admin log + corrections
router.get("/", view, controller.list);
router.post("/", create, validator.create, controller.create);
router.get("/:id", view, controller.get);
router.patch("/:id", edit, validator.update, controller.update);
router.post("/:id/clock-out", edit, controller.clockOutById);
router.delete("/:id", del, controller.archive);

module.exports = { basePath: "/attendance", feature: null, router };
