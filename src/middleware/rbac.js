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
 * Record-level scope: `user_scope`/`scope` (entity/branch) are now
 * consulted here (see doc/WORK_DONE.md) — req.scope_ids is set to the
 * caller's assigned scope_ids, or null if they have none (null =
 * unrestricted, same as today's pre-existing behavior, so tenants that
 * never bothered assigning scopes aren't suddenly locked out). Modules opt
 * into actually filtering by declaring `scopeColumn` in their makeRepo()
 * config (shared/crud/resource.js) — this wires the mechanism end-to-end
 * but doesn't retrofit which column means "scope" on each of the 70
 * existing module tables; that's a per-module call outside this pass.
 *
 * NOT YET HANDLED (flagged, not silently dropped):
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
      req.scope_ids = null;
      return next();
    }

    if (!req.tenantDb) {
      throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before requirePermission", 500);
    }

    // Cached (30 s TTL; permission/role writes invalidate every grants entry)
    // — saves a DB round-trip on every permission-gated request. One
    // tenantDb call resolves both the grant check and the caller's scope
    // assignment together.
    const { grants, scopeIds } = await req.tenantDb(async (client) => ({
      grants: await identityCache.getGrants(client, { role_ids: req.user.role_ids, module: moduleKey }),
      scopeIds: await identityCache.getUserScopeIds(client, req.user.user_id),
    }));

    const allowed = grants.some((g) => g[column] === true);
    if (!allowed) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission for ${moduleKey}.${action}`,
        403,
      );
    }

    // null = unrestricted (no scope rows assigned — today's behavior,
    // unchanged); a non-empty array confines the request to those scopes.
    // Repos that opt in (cfg.scopeColumn) filter by this; repos that don't
    // ignore it entirely, same as before this change.
    req.scope_ids = scopeIds.length ? scopeIds : null;
    req.permission_scope = req.scope_ids ? "scoped" : "all";
    return next();
  };
}

/**
 * Capability (authority-overlay) gate — the segregation-of-duties layer that
 * sits on top of requirePermission's role×module grant. Use it to demand a
 * specific authority code (ISSUER / VALIDATOR / APPROVER / LINE_MANAGER) on a
 * route, independent of the module CRUD grant:
 *
 *   router.post('/costings/:id/approve',
 *     authMiddleware,
 *     requirePermission('MOD-46', 'approve'),
 *     requireCapability('APPROVER'),
 *     controller.approve);
 *
 * `requireCapability('LINE_MANAGER')` also passes for users whose *role* is
 * flagged is_line_manager (resolved in identity-cache.getUserCapabilities),
 * which is what "Line Manager as a capability layered on any role" means.
 * CEO bypasses, same as requirePermission. Also attaches req.capabilities /
 * req.is_line_manager for downstream handlers that want to branch on them.
 */
function requireCapability(code) {
  if (!code || typeof code !== "string") {
    throw new Error("requireCapability: capability code required");
  }
  return async function capabilityCheck(req, _res, next) {
    if (!req.user) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }
    if (req.user.is_ceo) {
      req.capabilities = ["ISSUER", "VALIDATOR", "APPROVER", "LINE_MANAGER"];
      req.is_line_manager = true;
      return next();
    }
    if (!req.tenantDb) {
      throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before requireCapability", 500);
    }
    const { capabilities, is_line_manager } = await req.tenantDb((client) =>
      identityCache.getUserCapabilities(client, req.user.user_id),
    );
    req.capabilities = capabilities;
    req.is_line_manager = is_line_manager;

    const ok = code === "LINE_MANAGER" ? is_line_manager : capabilities.includes(code);
    if (!ok) {
      throw new AppError("CAPABILITY_REQUIRED", `Requires the ${code} authority`, 403);
    }
    return next();
  };
}

module.exports = { requirePermission, requireCapability };
