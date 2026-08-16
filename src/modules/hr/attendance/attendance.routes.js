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

/* ── Reconciled days (0697) ────────────────────────────────────────────────
 *
 * READING a day is `view`, and the caller's OWN days take no grant at all
 * (`/days/mine`) — an employee is always entitled to see what was recorded
 * against them and what it cost.
 *
 * WAIVING is `approve`, not `edit`: it moves money off a payslip. That is the
 * same authority as approving the leave that would have excused the day, and a
 * strictly larger one than correcting a punch.
 *
 * RE-RUNNING a date is `edit`. It writes rows and can create a charge, but it
 * only ever recomputes what the rules already say — and it must be reachable
 * by whoever corrected the punch that made it wrong, not only by an approver.
 */
router.get("/days/mine", validator.dayWindow, controller.myDays);
router.get("/days", view, validator.dayWindow, controller.days);
router.post("/days/:dayId/justify", requirePermission(M, "approve"), validator.justify, controller.justifyDay);
router.post("/reconcile", edit, validator.reconcileRun, controller.runReconcile);

// Registered devices (0524). Registering is `create`, the same grant as making
// a punch, because it is a self-service act by the person about to clock in —
// under `block` an employee whose device is refused must be able to put it in
// front of a manager without holding an admin grant. DECIDING on one is `edit`:
// approving a device is what makes its punches count.
router.get("/devices", view, controller.listDevices);
router.post("/devices", create, validator.deviceRegister, controller.registerDevice);
router.patch("/devices/:deviceId", edit, validator.deviceUpdate, controller.updateDevice);

// Worksites (geofence centres). `place-search` is `edit`, not `view`: it spends
// provider quota and only exists to fill in the create form, so it is gated on
// the grant that can actually use the answer.
router.get("/place-search", edit, validator.placeSearch, controller.placeSearch);
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
