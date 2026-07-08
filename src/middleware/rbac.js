/**
 * RBAC middleware (DB_ARCHITECTURE.md §4.2 — MOD-67, "RBAC as data").
 *
 * Usage:
 *   router.post(
 *     '/roles',
 *     authMiddleware,
 *     requirePermission('MOD-67', 'create'),
 *     controller.create,
 *   );
 *
 * Real permission table layout (migrations/tenant/0110_rbac.sql):
 *   permission(role_id, module_key, can_create, can_read, can_update,
 *              can_delete, can_approve)
 *     where module_key matches platform.module_catalogue, e.g. 'MOD-67'.
 *
 * Fixed vs. the original: this previously assumed a `shared.permissions`
 * table with `module`/`action`/`record_scope`/`allowed` columns and called
 * `identityCache.getGrants(...)` with no tenant client — neither the table
 * nor identity-cache.js existed, and the action vocabulary (view/edit/
 * export/publish) didn't map onto the actual can_create/read/update/
 * delete/approve columns. This version keeps the same friendly action
 * names (existing callers — ai/insights, ai/governance — pass 'view' etc.)
 * but maps them onto the real columns below.
 *
 * NOT YET HANDLED (flagged, not silently dropped):
 *   - record-level scope ('own'/'team'/'all') — the `permission` table has
 *     no such column; `user_scope`/`scope` exist for entity/branch scoping
 *     but aren't wired into this check yet. Every grant is currently
 *     treated as full-module ('all') access. See doc/RBAC_SECURITY_KICKOFF.md.
 *   - 'export' and 'publish' have no dedicated DB column yet — mapped to
 *     can_read / can_update respectively as a placeholder; revisit if the
 *     product needs to grant them independently of read/update.
 *
 * CEO bypasses checks (role.code = 'CEO', PRD §3).
 */

"use strict";

const { AppError } = require("../utils/errors");
const identityCache = require("../shared/cache/identity-cache");

const ACTION_COLUMN = {
  view: "can_read",
  read: "can_read",
  create: "can_create",
  edit: "can_update",
  update: "can_update",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_read", // TODO: add permission.can_export if this needs to be independent
  publish: "can_update", // TODO: add permission.can_publish if this needs to be independent
};

function requirePermission(moduleKey, action) {
  if (!moduleKey || typeof moduleKey !== "string") {
    throw new Error("requirePermission: moduleKey required");
  }
  const column = ACTION_COLUMN[action];
  if (!column) {
    throw new Error(`requirePermission: invalid action "${action}"`);
  }

  return async function rbacCheck(req, _res, next) {
    if (!req.user) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }

    // CEO bypass (PRD §3 — CEO sees everything by design)
    if (req.user.is_ceo) {
      req.permission_scope = "all";
      return next();
    }

    if (!req.tenantDb) {
      throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before requirePermission", 500);
    }

    // Cached (30 s TTL; permission/role writes invalidate every grants entry)
    // — saves a DB round-trip on every permission-gated request.
    const grants = await req.tenantDb((client) =>
      identityCache.getGrants(client, { role_ids: req.user.role_ids, module: moduleKey }),
    );

    const allowed = grants.some((g) => g[column] === true);
    if (!allowed) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission for ${moduleKey}.${action}`,
        403,
      );
    }

    // Record-level scope isn't modelled in `permission` yet — see note above.
    req.permission_scope = "all";
    return next();
  };
}

module.exports = { requirePermission };
