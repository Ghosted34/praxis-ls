/**
 * Per-task approval permission (audit finding W3).
 *
 * `requirePermission(module, action)` binds a module at mount time, which is
 * right for every other route in the codebase and wrong for this one: the
 * approvals endpoint serves tasks belonging to many modules, and gating it on a
 * single key meant "may approve a payroll run" and "may administer IAM" were the
 * same grant. This middleware resolves the module from the task itself
 * (approval_task.module_key, 0488) and then applies the ordinary grant check, so
 * the answer to "may this person approve this" comes from the permission matrix
 * row for the module that owns the record.
 *
 * Deliberately mirrors middleware/rbac.js rather than importing it: the module
 * key isn't known until the task is read, and requirePermission builds its
 * closure before the request exists.
 *
 * Fallbacks, both toward availability rather than lockout — a task nobody can
 * action is a stuck document, which is the failure this audit kept finding:
 *   · task has no module_key (pre-0488 rows whose workflow or event type was
 *     since deleted) → MOD-67, the historical gate.
 *   · CEO → through, consistent with requirePermission (PRD §3).
 * Not finding the TASK is a 404 from the service layer, not a 403 here — this
 * middleware only decides permission, never existence.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const identityCache = require("../../shared/cache/identity-cache");

const FALLBACK_MODULE = "MOD-67";

/** The module whose approve grant gates this task, or null if the task is gone. */
async function moduleForTask(client, approvalTaskId) {
  const { rows } = await client.query(
    "SELECT module_key FROM approval_task WHERE approval_task_id = $1",
    [approvalTaskId],
  );
  if (!rows.length) return null;
  return rows[0].module_key || FALLBACK_MODULE;
}

function requireApprovalPermission() {
  return async function approvalRbacCheck(req, _res, next) {
    if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    if (req.user.is_ceo) return next();

    const moduleKey = await req.tenantDb((c) => moduleForTask(c, req.params.id));
    // Task not found: let the service raise the 404 with its own message rather
    // than leaking existence through a permission error.
    if (!moduleKey) return next();

    const grants = await req.identityDb((c) =>
      identityCache.getGrants(c, { role_ids: req.user.role_ids, module: moduleKey }),
    );
    if (!grants.some((g) => g.can_approve === true)) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission to approve for ${moduleKey}`,
        403,
      );
    }
    req.approval_module_key = moduleKey;
    return next();
  };
}

module.exports = { requireApprovalPermission, moduleForTask, FALLBACK_MODULE };
