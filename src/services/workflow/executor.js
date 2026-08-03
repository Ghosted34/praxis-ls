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
const { logger } = require("../../config/logger");

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Does a step apply to this amount? (null bound = unbounded.)
 *
 * An UNKNOWN amount (null/undefined) applies to EVERY step, so the full chain
 * runs. It used to be coerced to 0 (`num(amount) || 0`), which inverted the
 * intent of threshold routing: in a workflow whose steps all carry a
 * `min_amount_xaf`, a record arriving with no total matched no step, `start`
 * returned `{ autoApproved: true, reason: "no_applicable_step" }`, and the
 * record skipped approval entirely. Several callers legitimately pass null when
 * a total is not yet computed (cash_request, payroll, purchase_order,
 * supplier_invoice), so "amount unknown" is a real, reachable state — and it
 * must mean *needs the most scrutiny*, not *needs none*. Audit finding W10.
 *
 * A genuine zero is still a zero and still only matches steps whose band
 * includes it.
 */
function stepApplies(step, amount) {
  const a = num(amount);
  if (a === null) return true;
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
    "SELECT w.*, et.module_key FROM workflow w JOIN event_type et ON et.event_type_id = w.event_type_id " +
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

/**
 * `module_key` (0488) is the module whose `approve` grant gates a decision on
 * this task — carried on the task rather than derived from the entity_ref prefix
 * at decision time, so it cannot drift from on-approved.js's handler map. It
 * comes from the workflow's bound event type; null is tolerated and falls back
 * to MOD-67 in the permission check, because a task nobody can action is worse
 * than one gated slightly too broadly.
 */
function createTask(client, wf, step, { entityRef, amountXaf }) {
  return insertOne(client, "approval_task", {
    workflow_id: wf.workflow_id, workflow_step_id: step.workflow_step_id,
    entity_ref: entityRef, amount_xaf: amountXaf ?? null,
    assigned_role_id: step.role_id || null, status: "PENDING",
    module_key: wf.module_key || null,
  });
}

/**
 * `autoApproved: true` is a CONTRACT, not an outcome: it means "no chain applies,
 * so the caller must finalise this record itself". Exactly one of the six
 * integrating callers honours it — final_invoice.service.js:116 posts on the
 * flag. The other five (costing, cash_request, payroll, purchase_order,
 * supplier_invoice) discard the return value, so with no workflow bound their
 * records sit in a submitted state with no approval task to act on and nothing
 * to finalise them (audit finding W8).
 *
 * Fixing those five properly means finalising AFTER their transaction commits —
 * their finalise handlers open their own BEGIN, and nesting would close the
 * caller's (the trap session 17 hit with milestone instantiation). That belongs
 * with the pass that closes the manual bypass routes (W4), because until then
 * the manual path is the escape hatch that makes the condition survivable.
 *
 * Until then this at least makes it DIAGNOSABLE rather than silent: every
 * auto-approval is logged with the event and the entity, so "why is this PO
 * still ISSUED_LOCKED" has an answer in the log instead of requiring someone to
 * re-derive it from the schema.
 */
function warnAutoApproved(eventTypeKey, entityRef, reason) {
  logger.warn(
    { eventTypeKey, entityRef, reason },
    "[workflow] no approval chain applied — the record will not finalise unless the caller handles autoApproved",
  );
}

/**
 * Open the first approval task for an approvable event. If no active workflow or
 * no applicable step, the record needs no approval → { autoApproved: true }.
 */
async function start(client, { eventTypeKey, entityRef, amountXaf = null, actorUserId = null }) {
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
  if (!wf) {
    warnAutoApproved(eventTypeKey, entityRef, "no_workflow");
    return { autoApproved: true, reason: "no_workflow" };
  }
  const steps = await getSteps(client, wf.workflow_id);
  const applicable = applicableSteps(steps, amountXaf);
  if (applicable.length === 0) {
    warnAutoApproved(eventTypeKey, entityRef, "no_applicable_step");
    return { autoApproved: true, reason: "no_applicable_step" };
  }
  const task = await createTask(client, wf, applicable[0], { entityRef, amountXaf });
  // Tell the eligible approvers (best-effort; never blocks task creation).
  await require("./notify-approvals").onTaskOpened(client, {
    entityRef, roleId: applicable[0].role_id, amountXaf, excludeUserId: actorUserId,
  });
  return { autoApproved: false, task, workflow_id: wf.workflow_id, step_seq: applicable[0].step_seq };
}

const ACTION_STATUS = { validate: "VALIDATED", approve: "APPROVED", reject: "REJECTED", skip: "SKIPPED" };

/** Which actions a step of each kind will accept. reject/skip are terminal or
 *  procedural and are allowed on both — only the affirmative verb is pinned, so
 *  a VALIDATE step cannot be cleared with `approve` and vice versa. Before this,
 *  the action was mapped straight to a status with no reference to step_kind, so
 *  either verb cleared either kind of step. */
const KIND_ACTIONS = {
  VALIDATE: ["validate", "reject", "skip"],
  APPROVE: ["approve", "reject", "skip"],
};

/**
 * May this actor act on this step?
 *
 * Two independent gates, both from the step's own configuration (audit findings
 * W2/W6 — before this, `act` checked only that the task was still PENDING, so
 * anyone holding the route's permission could clear any task at any step of any
 * document, and the step's role/scope binding survived only as the notification
 * recipient list):
 *
 *   role  — the actor must hold the step's role. A step with no role is
 *           unrestricted, which is what every step built through the UI is today
 *           (the designer has no role picker), so this cannot lock out an
 *           existing tenant.
 *   scope — the step's scope must fall inside the actor's downward scope closure
 *           (their nodes plus everything beneath them). A step with no scope is
 *           tenant-wide. An actor with no scope assignment satisfies only
 *           unscoped steps: not being in the organigramme is not the same as
 *           being everywhere in it.
 *
 * The CEO bypasses both, consistent with requirePermission (PRD §3). The CEO does
 * NOT bypass maker-checker below — see the note there.
 */
function assertEligible(task, actor) {
  if (actor.is_ceo === true) return;

  if (task.step_role_id) {
    const held = Array.isArray(actor.role_ids) ? actor.role_ids : [];
    if (!held.includes(task.step_role_id)) {
      throw new AppError(
        "NOT_ELIGIBLE",
        "This step is assigned to a role you do not hold",
        403,
      );
    }
  }

  if (task.step_scope_id) {
    const closure = Array.isArray(actor.scope_ids) ? actor.scope_ids : [];
    if (!closure.includes(task.step_scope_id)) {
      throw new AppError(
        "NOT_ELIGIBLE",
        "This step belongs to a part of the organisation you are not responsible for",
        403,
      );
    }
  }

  // Capability (the ISSUER/VALIDATOR/APPROVER authority overlay). The step
  // designer has always collected this and nothing has ever enforced it:
  // `requireCapability` exists in middleware/rbac.js with ZERO call sites, and
  // createTask dropped the column, so segregation of duties was labelling
  // (audit findings W6/W7). Same null-means-unrestricted rule as role and scope,
  // which matters here because `user_capability` is as unpopulated as
  // `user_scope` was — a step that names no capability is unaffected, so this
  // cannot lock out an existing tenant.
  if (task.step_capability_code) {
    const held = Array.isArray(actor.capabilities) ? actor.capabilities : [];
    if (!held.includes(task.step_capability_code)) {
      throw new AppError(
        "NOT_ELIGIBLE",
        `This step requires the ${task.step_capability_code} authority`,
        403,
      );
    }
  }
}

/**
 * Maker-checker: the person who raised a record may never decide it.
 *
 * The "maker" is the earliest attributed actor on the entity in `event_log`,
 * which is how `notify-approvals` already identifies the requester to notify —
 * the comparison existed, it just decided whether to send a notification rather
 * than whether the action was allowed (audit finding W5).
 *
 * Enforced for EVERYONE, CEO included. That is a deliberate departure from the
 * CEO's RBAC bypass: segregation of duties is the one control whose whole
 * purpose is that no single person can complete a transaction alone, and a
 * bypass for the most powerful account is the case it exists for. Confirmed as
 * "maker-checker must always be enforced". On a tenant small enough that the
 * only approver is also the only requester, this WILL block — that is the
 * control working, and the answer is a second user, not an exemption.
 *
 * A null maker (nothing attributed on the entity, e.g. a system-generated record,
 * or TEST mode where actor attribution is dropped to survive the cross-schema FK)
 * means there is no one to check against — an absence, not a bypass.
 */
async function assertNotMaker(client, task, actor) {
  if (!actor.user_id) return;
  const repo = require("../../modules/notification/notification.repo");
  const maker = await repo.requesterFor(client, task.entity_ref);
  if (maker && maker === actor.user_id) {
    throw new AppError(
      "SELF_APPROVAL",
      "You raised this item — it must be decided by someone else",
      403,
    );
  }
}

/**
 * Record a decision on a task and advance. Returns one of:
 *   { completed: true, approved: false }        — rejected
 *   { advanced: true, task }                    — next step opened
 *   { completed: true, approved: true }         — final step cleared → caller posts
 *
 * `actor` is `{ user_id, role_ids, is_ceo, scope_ids }` — role_ids and is_ceo come
 * from the session (middleware/auth.js), scope_ids is the caller's scope CLOSURE
 * resolved on the identity client by the controller. It must be the closure, not
 * the raw `user_scope` rows, and it must come from identity: scope membership is
 * env-independent like grants, so reading it on the env client would judge a TEST
 * approval against an empty sandbox.user_scope.
 */
async function act(client, { approvalTaskId, action, actor = {}, note = null }) {
  const status = ACTION_STATUS[action];
  if (!status) throw new AppError("BAD_ACTION", "action must be validate|approve|reject|skip", 422);

  const { rows } = await client.query(
    "SELECT at.*, ws.step_seq, ws.workflow_id, ws.step_kind, " +
      "ws.role_id AS step_role_id, ws.scope_id AS step_scope_id, " +
      "ws.capability_code AS step_capability_code " +
      "FROM approval_task at " +
      "JOIN workflow_step ws ON ws.workflow_step_id = at.workflow_step_id WHERE at.approval_task_id = $1",
    [approvalTaskId],
  );
  const task = rows[0];
  if (!task) throw new AppError("NOT_FOUND", "Approval task not found", 404);
  if (task.status !== "PENDING") throw new AppError("ALREADY_ACTED", "Task already " + task.status, 422);

  const allowed = KIND_ACTIONS[task.step_kind] || Object.keys(ACTION_STATUS);
  if (!allowed.includes(action)) {
    throw new AppError(
      "WRONG_ACTION_FOR_STEP",
      `Step ${task.step_seq} is a ${task.step_kind} step — it cannot be actioned with "${action}"`,
      422,
    );
  }

  assertEligible(task, actor);
  await assertNotMaker(client, task, actor);

  await client.query(
    "UPDATE approval_task SET status = $2, acted_by = $3, acted_at = now(), note = $4 WHERE approval_task_id = $1",
    [approvalTaskId, status, actor.user_id || null, note],
  );

  const notifyApprovals = require("./notify-approvals");

  if (action === "reject") {
    await notifyApprovals.onOutcome(client, { entityRef: task.entity_ref, approved: false, actorUserId: actor.user_id || null });
    return { completed: true, approved: false, entityRef: task.entity_ref };
  }

  const steps = await getSteps(client, task.workflow_id);
  const next = nextStep(steps, task.step_seq, task.amount_xaf);
  if (!next) {
    await notifyApprovals.onOutcome(client, { entityRef: task.entity_ref, approved: true, actorUserId: actor.user_id || null });
    return { completed: true, approved: true, entityRef: task.entity_ref };
  }
  const newTask = await createTask(client, { workflow_id: task.workflow_id }, next, { entityRef: task.entity_ref, amountXaf: task.amount_xaf });
  // Notify the next step's approvers that it's now their turn.
  await notifyApprovals.onTaskOpened(client, { entityRef: task.entity_ref, roleId: next.role_id, amountXaf: task.amount_xaf, excludeUserId: actor.user_id || null });
  return { advanced: true, task: newTask, step_seq: next.step_seq };
}

async function pendingForEntity(client, entityRef) {
  const { rows } = await client.query(
    "SELECT * FROM approval_task WHERE entity_ref = $1 ORDER BY created_at ASC",
    [entityRef],
  );
  return rows;
}

module.exports = {
  stepApplies, applicableSteps, nextStep, start, act, pendingForEntity,
  // Exported for unit tests — the routing and eligibility rules are pure and are
  // the part worth pinning down, same rationale as stepApplies/nextStep above.
  assertEligible, KIND_ACTIONS,
};
