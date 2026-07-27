/**
 * Approval-chain executor (doc/BUILD_CONVENTIONS.md §2/§6) — the runtime that
 * turns a tenant's configurable workflow into live approval tasks.
 *
 * A tenant designs `workflow` + ordered `workflow_step`s (each: VALIDATE|APPROVE,
 * a role/capability, a scope, and min/max amount thresholds). When an approvable
 * event fires, `start` opens the first applicable step as an `approval_task`;
 * `act` records a decision and advances to the next applicable step, or completes
 * (approved/rejected). Modules react to completion to post the record. Step
 * routing is pure (amount thresholds + ordering) so it is unit-testable.
 */
"use strict";

const { insertOne } = require("../../shared/db/query-helpers");
const { AppError } = require("../../utils/errors");

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Does a step apply to this amount? (null bound = unbounded; null amount = 0) */
function stepApplies(step, amount) {
  const a = num(amount) || 0;
  const min = num(step.min_amount_xaf);
  const max = num(step.max_amount_xaf);
  return (min === null || a >= min) && (max === null || a <= max);
}

/** All steps that apply, in order. */
function applicableSteps(steps, amount) {
  return steps.filter((s) => stepApplies(s, amount)).sort((a, b) => a.step_seq - b.step_seq);
}

/** The next applicable step after `afterSeq`, or null. */
function nextStep(steps, afterSeq, amount) {
  return applicableSteps(steps, amount).find((s) => s.step_seq > afterSeq) || null;
}

// ── DB layer ────────────────────────────────────────────────────────────────

async function getWorkflowForEvent(client, eventTypeKey) {
  const { rows } = await client.query(
    "SELECT w.* FROM workflow w JOIN event_type et ON et.event_type_id = w.event_type_id " +
      "WHERE et.key = $1 AND w.is_active = true AND et.is_approvable = true ORDER BY w.created_at DESC LIMIT 1",
    [eventTypeKey],
  );
  return rows[0] || null;
}

async function getSteps(client, workflowId) {
  const { rows } = await client.query(
    "SELECT * FROM workflow_step WHERE workflow_id = $1 ORDER BY step_seq ASC",
    [workflowId],
  );
  return rows;
}

function createTask(client, wf, step, { entityRef, amountXaf }) {
  return insertOne(client, "approval_task", {
    workflow_id: wf.workflow_id, workflow_step_id: step.workflow_step_id,
    entity_ref: entityRef, amount_xaf: amountXaf ?? null,
    assigned_role_id: step.role_id || null, status: "PENDING",
  });
}

/**
 * Open the first approval task for an approvable event. If no active workflow or
 * no applicable step, the record needs no approval → { autoApproved: true }.
 */
async function start(client, { eventTypeKey, entityRef, amountXaf = null }) {
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  // Idempotency guard: never open a second chain for an entity that already has
  // a pending task. This lets the universal emit-hook and a module's explicit
  // start() coexist without ever double-opening.
  const dup = await client.query(
    "SELECT 1 FROM approval_task WHERE entity_ref = $1 AND status = 'PENDING' LIMIT 1",
    [entityRef],
  );
  if (dup.rows.length) return { autoApproved: false, alreadyPending: true };
  const wf = await getWorkflowForEvent(client, eventTypeKey);
  if (!wf) return { autoApproved: true, reason: "no_workflow" };
  const steps = await getSteps(client, wf.workflow_id);
  const applicable = applicableSteps(steps, amountXaf);
  if (applicable.length === 0) return { autoApproved: true, reason: "no_applicable_step" };
  const task = await createTask(client, wf, applicable[0], { entityRef, amountXaf });
  return { autoApproved: false, task, workflow_id: wf.workflow_id, step_seq: applicable[0].step_seq };
}

const ACTION_STATUS = { validate: "VALIDATED", approve: "APPROVED", reject: "REJECTED", skip: "SKIPPED" };

/**
 * Record a decision on a task and advance. Returns one of:
 *   { completed: true, approved: false }        — rejected
 *   { advanced: true, task }                    — next step opened
 *   { completed: true, approved: true }         — final step cleared → caller posts
 */
async function act(client, { approvalTaskId, action, actor = {}, note = null }) {
  const status = ACTION_STATUS[action];
  if (!status) throw new AppError("BAD_ACTION", "action must be validate|approve|reject|skip", 422);

  const { rows } = await client.query(
    "SELECT at.*, ws.step_seq, ws.workflow_id FROM approval_task at " +
      "JOIN workflow_step ws ON ws.workflow_step_id = at.workflow_step_id WHERE at.approval_task_id = $1",
    [approvalTaskId],
  );
  const task = rows[0];
  if (!task) throw new AppError("NOT_FOUND", "Approval task not found", 404);
  if (task.status !== "PENDING") throw new AppError("ALREADY_ACTED", "Task already " + task.status, 422);

  await client.query(
    "UPDATE approval_task SET status = $2, acted_by = $3, acted_at = now(), note = $4 WHERE approval_task_id = $1",
    [approvalTaskId, status, actor.user_id || null, note],
  );

  if (action === "reject") return { completed: true, approved: false, entityRef: task.entity_ref };

  const steps = await getSteps(client, task.workflow_id);
  const next = nextStep(steps, task.step_seq, task.amount_xaf);
  if (!next) return { completed: true, approved: true, entityRef: task.entity_ref };
  const newTask = await createTask(client, { workflow_id: task.workflow_id }, next, { entityRef: task.entity_ref, amountXaf: task.amount_xaf });
  return { advanced: true, task: newTask, step_seq: next.step_seq };
}

async function pendingForEntity(client, entityRef) {
  const { rows } = await client.query(
    "SELECT * FROM approval_task WHERE entity_ref = $1 ORDER BY created_at ASC",
    [entityRef],
  );
  return rows;
}

module.exports = { stepApplies, applicableSteps, nextStep, start, act, pendingForEntity };
