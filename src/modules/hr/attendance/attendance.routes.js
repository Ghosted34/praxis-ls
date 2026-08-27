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
// Renaming YOUR OWN device is `create`, the grant that already lets you punch —
// declared BEFORE the `edit` route below so the more specific path wins. The
// two are separate endpoints because the decisions are: "this is my phone" is
// the employee's to make, "this device is trusted" is the manager's. Sharing
// one route would mean gating the first behind the second, and the only person
// who knows what the device actually is could not say so.
router.patch("/devices/:deviceId/name", create, validator.deviceRename, controller.renameOwnDevice);
router.patch("/devices/:deviceId", edit, validator.deviceUpdate, controller.updateDevice);

// Worksites (geofence centres). `place-search` is `edit`, not `view`: it spends
// provider quota and only exists to fill in the create form, so it is gated on
// the grant that can actually use the answer.
router.get("/place-search", edit, validator.placeSearch, controller.placeSearch);
router.get("/work-sites", view, controller.listSites);
router.post("/work-sites", edit, validator.workSite, controller.createSite);
router.patch("/work-sites/:siteId", edit, validator.workSiteUpdate, controller.updateSite);

/* ── History, analytics and the download (PR2) ─────────────────────────────
 *
 * DECLARED BEFORE `/:id`, like every specific path in this file. `/analytics`
 * and `/export` are not uuids, but Express does not know that — `/:id` has no
 * pattern on it, so whichever route is declared first wins and a later
 * `/analytics` would be swallowed as `get(id = "analytics")`. The file already
 * makes this point about `/devices/:deviceId/name`; this is the same rule.
 *
 * The `/mine` variants take NO grant, deliberately. An employee is entitled to
 * their own attendance — the same reasoning `/days/mine` records above — and
 * they reach service functions that resolve the employee from the token rather
 * than from the query string, so there is nothing on them to point at somebody
 * else.
 *
 * The `/mine` route of each pair is declared FIRST for the same shadowing
 * reason as everything else here.
 */
router.get("/analytics/mine", validator.punchWindow, controller.myAnalytics);
router.get("/analytics", view, validator.analyticsWindow, controller.analytics);
router.get("/export/mine", validator.exportWindow, controller.myExport);
router.get("/export", view, validator.exportWindow, controller.exportWindow);
router.get("/punches/mine", validator.punchWindow, controller.myPunches);

/* ── The map, and the weekly summariser (PR3) ──────────────────────────────
 *
 * `/map` carries NO `requirePermission`, and that is the design rather than an
 * omission. The guide's matrix (§3.6) is five outcomes from two grants, not a
 * yes/no: an employee with no HR grant still sees their OWN pins, and a Control
 * Tower user with no MOD-14 grant sees the commercial lanes and none of HR's.
 * A `view` gate in front of this would 403 both of them; the controller resolves
 * MOD-14 and MOD-00A itself and narrows the ANSWER, which is what "strips
 * subjects the actor cannot see" means. Same reasoning as the `/mine` routes
 * above — the scope comes from the token and the grants, never from the query
 * string, and `mapWindow` has no employee selector on it to forget to check.
 *
 * `/weekly-summaries` IS gated, at `edit`: it writes queries. Not `approve` —
 * it raises a question, it does not waive a deduction or decide anything, which
 * is the same line `/reconcile` sits on.
 */
router.get("/map", validator.mapWindow, controller.map);
router.post("/weekly-summaries", edit, validator.weeklyRun, controller.runWeekly);

// Admin log + corrections
router.get("/", view, controller.list);
router.post("/", create, validator.create, controller.create);
router.get("/:id", view, controller.get);
router.patch("/:id", edit, validator.update, controller.update);
router.post("/:id/clock-out", edit, controller.clockOutById);
router.delete("/:id", del, controller.archive);

module.exports = { basePath: "/attendance", feature: null, router };
