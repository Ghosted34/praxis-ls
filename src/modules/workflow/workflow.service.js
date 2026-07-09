/**
 * Business logic for the event/workflow admin surface. Every write emits an
 * event + writes the immutable audit trail, same contract as makeService()'s
 * generic path (this module is hand-written rather than generic because it
 * spans four related tables, not one).
 */
"use strict";

const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const repo = require("./workflow.repo");
const events = require("./workflow.events");

const M = events.MODULE;

module.exports = {
  // ---- event_type registration ----
  listEventTypes: (client, q) => repo.listEventTypes(client, q),

  async registerEventType(client, { data, actor }) {
    const row = await repo.registerEventType(client, data);
    await emitEvent(client, {
      eventTypeKey: events.EVENT_TYPE_REGISTERED,
      moduleKey: M,
      entityRef: `event_type:${row.event_type_id}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.EVENT_TYPE_REGISTERED,
      moduleKey: M,
      entityRef: `event_type:${row.event_type_id}`,
      after: row,
    });
    return row;
  },

  // ---- workflow ----
  listWorkflows: (client, q) => repo.listWorkflows(client, q),

  async getWorkflow(client, id) {
    const workflow = await repo.getWorkflow(client, id);
    if (!workflow) return null;
    workflow.steps = await repo.listSteps(client, id);
    return workflow;
  },

  async createWorkflow(client, { data, actor }) {
    const et = await repo.getEventTypeByKey(client, data.event_type_key);
    if (!et) throw new AppError("UNKNOWN_EVENT_TYPE", `No event type '${data.event_type_key}'`, 400);
    if (!et.is_approvable) {
      throw new AppError(
        "NOT_APPROVABLE",
        `Event type '${et.key}' is not approvable — a workflow can only bind to an approvable event`,
        400,
      );
    }
    const row = await repo.createWorkflow(client, { event_type_id: et.event_type_id, name: data.name });
    await emitEvent(client, {
      eventTypeKey: events.WORKFLOW_CREATED,
      moduleKey: M,
      entityRef: `workflow:${row.workflow_id}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.WORKFLOW_CREATED,
      moduleKey: M,
      entityRef: `workflow:${row.workflow_id}`,
      after: row,
    });
    return row;
  },

  async updateWorkflow(client, { id, patch, actor }) {
    const before = await repo.getWorkflow(client, id);
    if (!before) return null;
    // Only name / is_active are editable here (event_type binding is fixed once set).
    const clean = {};
    if (patch.name !== undefined) clean.name = patch.name;
    if (patch.is_active !== undefined) clean.is_active = patch.is_active === true;
    const row = Object.keys(clean).length ? await repo.updateWorkflow(client, id, clean) : before;
    await emitEvent(client, {
      eventTypeKey: events.WORKFLOW_UPDATED,
      moduleKey: M,
      entityRef: `workflow:${id}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.WORKFLOW_UPDATED,
      moduleKey: M,
      entityRef: `workflow:${id}`,
      before,
      after: row,
    });
    return row;
  },

  // ---- steps ----
  listSteps: (client, workflowId) => repo.listSteps(client, workflowId),

  async addStep(client, { workflowId, data, actor }) {
    const workflow = await repo.getWorkflow(client, workflowId);
    if (!workflow) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    const row = await repo.addStep(client, { ...data, workflow_id: workflowId });
    await emitEvent(client, {
      eventTypeKey: events.STEP_ADDED,
      moduleKey: M,
      entityRef: `workflow_step:${row.workflow_step_id}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.STEP_ADDED,
      moduleKey: M,
      entityRef: `workflow_step:${row.workflow_step_id}`,
      after: row,
    });
    return row;
  },

  async removeStep(client, { workflowId, stepId, actor }) {
    const removed = await repo.removeStep(client, workflowId, stepId);
    if (!removed) return null;
    await emitEvent(client, {
      eventTypeKey: events.STEP_REMOVED,
      moduleKey: M,
      entityRef: `workflow_step:${stepId}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.STEP_REMOVED,
      moduleKey: M,
      entityRef: `workflow_step:${stepId}`,
    });
    return removed;
  },

  // ---- approvals (read-only runtime) ----
  listApprovals: (client, q) => repo.listApprovals(client, q),
};
