/**
 * My Workspace (MOD-00A). Any authenticated user sees their own.
 *
 * ── ONE MODULE, THREE ROUTERS ──────────────────────────────────────────────
 *
 * Tasks and events are composed as sub-routers here rather than declared as
 * their own modules, so the whole surface answers under one base path and one
 * permission module. The loader supports this explicitly — `app_user` mounts
 * /users and /auth the same way — and it is what keeps "My workspace" a single
 * thing in the IAM matrix instead of three entries an administrator has to
 * grant in step.
 *
 * The consequence worth knowing: `feature` is declared ONCE for the module, so
 * tasks and events cannot be switched off independently of the workspace. That
 * is deliberate — they are the workspace — but it does mean there is no
 * per-tenant kill switch for the calendar alone.
 *
 * ── ROUTE ORDER IS LOAD-BEARING ────────────────────────────────────────────
 *
 * `/tasks/board` and `/tasks/assignees` are declared BEFORE `/tasks/:id`.
 * Express matches in declaration order, so a literal path declared second is
 * unreachable: `/tasks/board` would be read as an id and 422 at the id guard.
 * That is a silent failure that looks like a broken client.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./workspace.controller");
const t = require("./tasks.controller");
const v = require("./tasks.validator");

const MODULE = "MOD-00A";
const can = (action) => requirePermission(MODULE, action);

/* ── /workspace/tasks ───────────────────────────────────────────────────── */
const tasks = express.Router();
tasks.get("/", can("view"), v.taskListQuery, t.listTasks);
tasks.get("/board", can("view"), v.boardQuery, t.getBoard);
// The audience travels to the detail read as well (B-03): a Team or All card
// the board legitimately rendered must open, and the server re-decides the
// request rather than trusting it.
tasks.get("/:id", can("view"), v.taskDetailQuery, t.getTask);
tasks.post("/", can("create"), v.taskCreate, t.createTask);
tasks.patch("/:id", can("edit"), v.taskUpdate, t.updateTask);
// Its own verb rather than a field on PATCH: a status change carries
// consequences (completed_at, an event, the assignee's notification) that a
// generic update should not have to reason about.
tasks.post("/:id/status", can("edit"), v.statusChange, t.changeStatus);
tasks.delete("/:id", can("delete"), t.deleteTask);

tasks.post("/:id/subtasks", can("edit"), v.subtaskAdd, t.addSubtask);
// One PATCH for both a step's edits — tick it done and/or move its deadline.
tasks.patch("/:id/subtasks/:subtaskId", can("edit"), v.subtaskPatch, t.patchSubtask);
tasks.delete("/:id/subtasks/:subtaskId", can("edit"), t.deleteSubtask);

tasks.post("/:id/watchers", can("edit"), v.watcherAdd, t.addWatcher);
tasks.delete("/:id/watchers/:userId", can("edit"), t.removeWatcher);
// Nudge the people already on this task. `edit` rather than `create`: a ping
// is an action ON a task, not a new record, and the service refuses anybody
// who is not its assignee, creator or watcher.
tasks.post("/:id/ping", can("edit"), v.taskPing, t.pingTask);

// A separately-assigned child. `create`, because it IS a task — the parent in
// the path is the only thing that distinguishes it from POST /tasks.
tasks.post("/:id/children", can("create"), v.childCreate, t.addChildTask);

// Blocked-by edges (13870). Adding one is `edit` on the blocked task rather
// than `create`: an edge is a statement about a task the caller already holds,
// and gating it on create would let somebody with create-only rights sequence
// work they cannot change.
tasks.post("/:id/dependencies", can("edit"), v.dependencyAdd, t.addDependency);
tasks.delete("/:id/dependencies/:dependencyId", can("edit"), t.removeDependency);
// "Proceed anyway" is its own verb rather than a field, for the same reason
// status is: it carries an attribution and an audit consequence that a generic
// patch should not have to reason about.
tasks.patch("/:id/dependencies/:dependencyId/override", can("edit"), v.dependencyOverride, t.overrideDependency);

// Blockages (13975) — an external hold with a note ("customs' network is
// down"). Raising and resolving are their own verbs rather than fields on a
// PATCH because each carries attribution, a notification contract and — on
// resolve — a due-date movement: consequences a generic patch should not have
// to reason about. `edit`, like the dependency edges above.
tasks.post("/:id/blockages", can("edit"), v.blockageRaise, t.raiseBlockage);
tasks.post("/:id/blockages/:blockageId/resolve", can("edit"), v.blockageResolve, t.resolveBlockage);

/* ── /workspace/events ──────────────────────────────────────────────────── */
const events = express.Router();
events.get("/", can("view"), v.eventListQuery, t.listEvents);
events.get("/:id", can("view"), t.getEvent);
events.post("/", can("create"), v.eventCreate, t.createEvent);
events.patch("/:id", can("edit"), v.eventUpdate, t.updateEvent);
events.delete("/:id", can("delete"), t.deleteEvent);

events.post("/:id/participants", can("edit"), v.participantAdd, t.addParticipant);
events.patch("/:id/participants/:participantId/response", can("edit"), v.participantRespond, t.respondParticipant);
events.delete("/:id/participants/:participantId", can("edit"), t.removeParticipant);

/* ── /workspace ─────────────────────────────────────────────────────────── */
const router = express.Router();
router.use(authMiddleware);
router.get("/", c.mine);
// Focused reads keep Today panels independently retryable and make a database
// failure visible instead of turning it into an empty queue.
router.get("/approvals", c.approvals);
router.get("/alerts", c.alerts);
// Tenant-local display and wall-clock serialization contract for Workspace UI.
router.get("/context", can("view"), c.context);
// Tasks and events interleaved by time — the Today surface, and the reason the
// two modules share a page rather than sitting side by side.
router.get("/day", can("view"), v.dayQuery, t.getDay);
// Task + subtask due dates for the calendar's deadline overlay — a read, laid
// over the events grid, that opens the task rather than an event dialog.
router.get("/deadlines", can("view"), v.deadlineQuery, t.getDeadlines);
// Operational Analytics — the fourth Workspace section. Gated on `view` like
// every other read here, and scoped by the SAME audience rules, so an
// aggregate can never total rows the caller could not have listed. It is
// deliberately NOT under /tasks: it reports on tasks but it is its own screen,
// its own registry entry and its own permission line.
router.get("/analytics", can("view"), v.analyticsQuery, t.getAnalytics);
router.use("/tasks", tasks);
router.use("/events", events);

module.exports = { basePath: "/workspace", feature: null, router };
