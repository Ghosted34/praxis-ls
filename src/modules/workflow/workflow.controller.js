"use strict";
const { asyncHandler, AppError } = require("../../utils/errors");
const service = require("./workflow.service");

const actor = (req) => req.user || { user_id: null };

module.exports = {
  // event_type
  listEventTypes: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listEventTypes(c, req.query)) }),
  ),
  registerEventType: asyncHandler(async (req, res) =>
    res
      .status(201)
      .json({ data: await req.tenantDb((c) => service.registerEventType(c, { data: req.body, actor: actor(req) })) }),
  ),

  // workflow
  listWorkflows: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listWorkflows(c, req.query)) }),
  ),
  getWorkflow: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.getWorkflow(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    res.json({ data: row });
  }),
  createWorkflow: asyncHandler(async (req, res) =>
    res
      .status(201)
      .json({ data: await req.tenantDb((c) => service.createWorkflow(c, { data: req.body, actor: actor(req) })) }),
  ),
  updateWorkflow: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.updateWorkflow(c, { id: req.params.id, patch: req.body, actor: actor(req) }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    res.json({ data: row });
  }),

  // steps
  listSteps: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listSteps(c, req.params.id)) }),
  ),
  addStep: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.addStep(c, { workflowId: req.params.id, data: req.body, actor: actor(req) }),
      ),
    }),
  ),
  removeStep: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.removeStep(c, { workflowId: req.params.id, stepId: req.params.stepId, actor: actor(req) }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Step not found", 404);
    res.json({ data: { removed: true } });
  }),

  // approvals
  listApprovals: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listApprovals(c, req.query)) }),
  ),
};
