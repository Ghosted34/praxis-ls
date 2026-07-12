"use strict";
const service = require("./workflow.service");
const validator = require("./workflow.validator");
module.exports = {
  entity: "workflow", module_key: "MOD-67", screens: [],
  reads: [
    { key: "list_event_types", service: (c, p) => service.listEventTypes(c, p), describe: "List registered event types (approvable ones can bind a workflow)." },
    { key: "list_workflows", service: (c, p) => service.listWorkflows(c, p), describe: "List approval workflows." },
    { key: "get_workflow", service: (c, p) => service.getWorkflow(c, p.id || p), describe: "Get a workflow with its steps (the tenant's approval hierarchy)." },
    { key: "list_approvals", service: (c, p) => service.listApprovals(c, p), describe: "Runtime approval-task queue." },
  ],
  writes: [
    { key: "create_workflow", service: (c, p) => service.createWorkflow(c, { data: p }), schema: validator.schemas.createWorkflow, permission: { module: "MOD-67", action: "create" }, confirm: true, describe: "Create an approval workflow bound to an approvable event type." },
    { key: "add_workflow_step", service: (c, p) => service.addStep(c, { workflowId: p.workflow_id, data: p }), schema: validator.schemas.addStep, permission: { module: "MOD-67", action: "edit" }, confirm: true, describe: "Add a validate/approve step (role/capability/scope + amount threshold)." },
    { key: "act_approval", service: (c, p) => service.actApproval(c, p), schema: validator.schemas.actApproval, permission: { module: "MOD-67", action: "approve" }, confirm: true, describe: "Validate/approve/reject an approval task." },
  ],
};
