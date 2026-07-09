/**
 * Universal Event Engine — admin API (WORK_TO_BE_DONE.md Phase 0). The schema
 * (event_type / workflow / workflow_step / approval_task) and the emit side
 * already existed; this is the missing registration + workflow-designer surface
 * so event types can be registered and validate/approve chains built without
 * hand-editing the DB.
 *
 * Gated authMiddleware + requirePermission('MOD-67', …), same pattern as the
 * IAM modules (see workflow.events.js for why MOD-67). Mounted at tenant root
 * (basePath '/') with explicit sub-paths so URLs read naturally:
 *   /api/tenant/event-types           GET  list · POST register
 *   /api/tenant/workflows             GET  list · POST create
 *   /api/tenant/workflows/:id         GET  detail(+steps) · PATCH edit
 *   /api/tenant/workflows/:id/steps   GET  list · POST add
 *   /api/tenant/workflows/:id/steps/:stepId   DELETE remove
 *   /api/tenant/approvals             GET  runtime approval_task queue
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./workflow.controller");
const validator = require("./workflow.validator");

const M = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

// event_type registry
router.get("/event-types", requirePermission(M, "view"), controller.listEventTypes);
router.post("/event-types", requirePermission(M, "create"), validator.registerEventType, controller.registerEventType);

// workflows
router.get("/workflows", requirePermission(M, "view"), controller.listWorkflows);
router.post("/workflows", requirePermission(M, "create"), validator.createWorkflow, controller.createWorkflow);
router.get("/workflows/:id", requirePermission(M, "view"), controller.getWorkflow);
router.patch("/workflows/:id", requirePermission(M, "edit"), validator.updateWorkflow, controller.updateWorkflow);

// workflow steps
router.get("/workflows/:id/steps", requirePermission(M, "view"), controller.listSteps);
router.post("/workflows/:id/steps", requirePermission(M, "edit"), validator.addStep, controller.addStep);
router.delete("/workflows/:id/steps/:stepId", requirePermission(M, "edit"), controller.removeStep);

// approval_task runtime queue (read-only)
router.get("/approvals", requirePermission(M, "view"), controller.listApprovals);

module.exports = { basePath: "/", feature: null, router };
