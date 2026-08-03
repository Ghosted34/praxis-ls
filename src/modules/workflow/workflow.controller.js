"use strict";
const { asyncHandler, AppError } = require("../../utils/errors");
const identityCache = require("../../shared/cache/identity-cache");
const service = require("./workflow.service");

const actor = (req) => req.user || { user_id: null };

/**
 * The actor for an approval decision, enriched with the scope closure the
 * executor's eligibility check needs (`assertEligible`).
 *
 * Resolved on `req.identityDb`, not `req.tenantDb`: scope membership is identity
 * data like roles and grants, so under TEST the env client would read an empty
 * `sandbox.user_scope` and deny every scoped step. Same reasoning as
 * middleware/rbac.js, which resolves scope ids on the identity client too.
 *
 * Skipped for the CEO (who bypasses eligibility) and for an unauthenticated
 * actor (which cannot reach here — the route is behind authMiddleware — but the
 * guard keeps this callable in isolation).
 */
/**
 * A workflow step points at a role and a scope, both of which live in the
 * identity (live) schema while the step itself is written to the env-selected
 * one. 0489 removed the foreign keys because they checked the writing schema and
 * so rejected valid ids under TEST; this replaces them with a check against the
 * schema the ids actually come from.
 */
async function assertStepRefs(req, body = {}) {
  const roleId = body.role_id || null;
  const scopeId = body.scope_id || null;
  if (!roleId && !scopeId) return;

  const missing = await req.identityDb(async (c) => {
    const out = [];
    if (roleId) {
      const { rows } = await c.query("SELECT 1 FROM role WHERE role_id = $1 LIMIT 1", [roleId]);
      if (!rows.length) out.push("role");
    }
    if (scopeId) {
      const { rows } = await c.query("SELECT 1 FROM scope WHERE scope_id = $1 LIMIT 1", [scopeId]);
      if (!rows.length) out.push("scope");
    }
    return out;
  });

  if (missing.length) {
    throw new AppError(
      "UNKNOWN_STEP_REFERENCE",
      `Unknown ${missing.join(" and ")} — pick from the list rather than sending an id directly.`,
      422,
    );
  }
}

async function approvalActor(req) {
  const u = actor(req);
  if (!u.user_id || u.is_ceo === true) return { ...u, scope_ids: [], capabilities: [] };
  const [scopeIds, caps] = await req.identityDb(async (c) => [
    await identityCache.getUserScopeClosure(c, u.user_id),
    await identityCache.getUserCapabilities(c, u.user_id),
  ]);
  return { ...u, scope_ids: scopeIds, capabilities: caps.capabilities || [] };
}

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
  addStep: asyncHandler(async (req, res) => {
    // A step's role and scope are IDENTITY data (live schema) while the step
    // itself is business data written to the env-selected schema, so the
    // database can't check them for us — 0489 drops those foreign keys because
    // under TEST they resolve against the wrong schema and reject valid ids.
    // Validate here instead, on the identity client, so a bad id still fails
    // loudly rather than being stored as a dangling reference that silently
    // makes the step unactionable.
    await assertStepRefs(req, req.body);
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.addStep(c, { workflowId: req.params.id, data: req.body, actor: actor(req) }),
      ),
    });
  }),
  removeStep: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.removeStep(c, { workflowId: req.params.id, stepId: req.params.stepId, actor: actor(req) }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Step not found", 404);
    res.json({ data: { removed: true } });
  }),

  // approvals
  listApprovals: asyncHandler(async (req, res) => {
    // Narrow the queue to what this caller could act on (W12). Roles come from
    // the session; the approvable modules are identity data, resolved on the
    // identity client for the same reason grants are.
    const u = actor(req);
    const viewer = u.is_ceo === true
      ? { isCeo: true }
      : {
        isCeo: false,
        roleIds: u.role_ids || [],
        moduleKeys: await req.identityDb((c) => identityCache.getApprovableModules(c, u.role_ids || [])),
      };
    res.json({ data: await req.tenantDb((c) => service.listApprovals(c, req.query, viewer)) });
  }),

  actApproval: asyncHandler(async (req, res) => {
    const decider = await approvalActor(req);
    const result = await req.tenantDb((c) => service.actApproval(c, {
      approvalTaskId: req.params.id, action: req.body.action, note: req.body.note,
      actor: decider,
    }));
    res.json({ data: result });
  }),
};
