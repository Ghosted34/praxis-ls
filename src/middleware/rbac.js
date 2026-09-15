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
 *              can_delete, can_approve, can_export, can_validate, can_disburse)
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
 *   - 'publish' has no dedicated DB column yet — mapped to can_update as a
 *     placeholder; revisit if the product needs to grant it independently.
 *     ('export' got one in 12771, alongside 'validate' and 'disburse'.)
 *
 * CEO bypasses checks (role.code = 'CEO', PRD §3).
 */

"use strict";

const { AppError } = require("../utils/errors");
const identityCache = require("../shared/cache/identity-cache");
const { logger } = require("../config/logger");
const metrics = require("../shared/observability/metrics");

/**
 * Friendly action → the `permission` column that grants it.
 *
 * 12771 closed two of the three standing TODOs here by giving `export`,
 * `validate` and `disburse` real columns, backfilled from whatever gated them
 * before, so no role lost access on deploy:
 *
 *   export    was can_read.    A right over DATA — taking a module's contents
 *                              out of the building — which does not follow from
 *                              being allowed to read it on screen.
 *   validate  was can_approve.  The finance visa. A visa, not a signature.
 *   disburse  was can_approve.  Handing over the cash. Separated because the
 *                              manager who approves a spend should not be the
 *                              cashier who releases it.
 *
 * `publish` still has no column of its own; it is one caller and no product
 * decision has been taken on it.
 */
const ACTION_COLUMN = {
  view: "can_read",
  read: "can_read",
  create: "can_create",
  edit: "can_update",
  update: "can_update",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_export",
  validate: "can_validate",
  disburse: "can_disburse",
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

    // CEO bypass (PRD §3 — CEO sees everything by design).
    //
    // `=== true`, not truthy. Grants below are compared exactly
    // (`g[column] === true`) and this must not be laxer than the thing it
    // bypasses. authMiddleware normalises is_ceo to a boolean today, so this
    // changes no behaviour — but the CEO flag skips EVERY check in the product,
    // and it should not depend on an upstream normalisation staying correct.
    if (req.user.is_ceo === true) {
      req.permission_scope = "all";
      req.scope_ids = null;
      return next();
    }

    if (!req.identityDb) {
      throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before requirePermission", 500);
    }

    // Cached (30 s TTL; permission/role writes invalidate every grants entry)
    // — saves a DB round-trip on every permission-gated request. One
    // identityDb call resolves both the grant check and the caller's scope
    // assignment together. RBAC grants are identity data (env-independent), so
    // they resolve against the live schema — same grants under LIVE and TEST.
    const { grants, scopeIds } = await req.identityDb(async (client) => ({
      grants: await identityCache.getGrants(client, { role_ids: req.user.role_ids, module: moduleKey }),
      // The CLOSURE, not the raw assignments: authority flows down the
      // organigramme, so someone assigned to HQ must see the branches beneath
      // it. Using the raw rows would have made assigning a regional manager to
      // HQ hide every branch record from them — worse than not scoping at all,
      // and the reason `parent_scope_id` existed but never did anything.
      scopeIds: await identityCache.getUserScopeClosure(client, req.user.user_id),
    }));

    const allowed = grants.some((g) => g[column] === true);
    if (!allowed) {
      // OBS-T4: rbac.js contained zero logger calls, so "why is this user
      // getting 403s?" had no answer anywhere, and a burst of denials — the
      // signature of a compromised account probing for access — was invisible.
      metrics.inc("praxis_rbac_denials_total", { module: moduleKey, action }, 1,
        "Permission denials by module and action.");
      logger.warn(
        { user_id: req.user.user_id, module: moduleKey, action },
        "permission denied",
      );
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission for ${moduleKey}.${action}`,
        403,
      );
    }

    // null = unrestricted (no scope rows assigned — today's behavior,
    // unchanged); a non-empty array confines the request to that closure.
    // Repos that opt in (cfg.scopeColumn) filter by this; repos that don't
    // ignore it entirely. A row with a NULL scope stays visible either way —
    // see shared/crud/resource.js for why.
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
    if (req.user.is_ceo === true) {
      req.capabilities = ["ISSUER", "VALIDATOR", "APPROVER", "LINE_MANAGER"];
      req.is_line_manager = true;
      return next();
    }
    if (!req.identityDb) {
      throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before requireCapability", 500);
    }
    const { capabilities, is_line_manager } = await req.identityDb((client) =>
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


/**
 * CEO-only guard for destructive/privileged surfaces (e.g. God Mode purge).
 * Unlike requirePermission (which any granted role passes), this admits ONLY the
 * CEO. Must run after authMiddleware (needs req.user.is_ceo).
 */
function requireCeo() {
  return function ceoCheck(req, _res, next) {
    if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    // `!== true` rather than `!`: this gate stands in front of the God Mode
    // purge, and a truthy non-boolean must not pass it.
    if (req.user.is_ceo !== true) throw new AppError("PERMISSION_DENIED", "This action is restricted to the CEO", 403);
    return next();
  };
}

/**
 * READ a caller's permissions without gating on them.
 *
 * `requirePermission` answers "may this request proceed?" by throwing. Some
 * screens need the weaker question — "would it?" — so they can shape what they
 * show: the signature designer lists the fields a signature is missing, and a
 * gap the reader cannot fix should read "ask an administrator" rather than
 * offering a link into a 403.
 *
 * ADDITIVE ON PURPOSE. `requirePermission` is untouched: this is a separate
 * function reusing the same grant cache and the same ACTION_COLUMN map, not a
 * refactor of the gate. A bug here shows the wrong hint; a bug in the gate is a
 * security incident, and the two should not share a control flow for the sake
 * of tidiness.
 *
 * NOT A SECURITY BOUNDARY. Nothing may be authorised on this answer. The
 * destination routes enforce their own permissions, and this only decides
 * whether a link is worth offering.
 *
 * @param {object} req    an authed request (needs req.user and req.identityDb)
 * @param {Array<[string,string]>} specs  [[moduleKey, action], …]
 * @returns {Promise<boolean[]>} one answer per spec, in order
 */
async function readPermissions(req, specs = []) {
  if (!req || !req.user || !Array.isArray(specs) || !specs.length) {
    return specs.map(() => false);
  }
  // Same bypass as the gate, and for the same reason — a CEO who saw "ask an
  // administrator" against a field they can edit would be told to ask
  // themselves.
  if (req.user.is_ceo === true) return specs.map(() => true);
  if (!req.identityDb) return specs.map(() => false);

  try {
    return await req.identityDb(async (client) => {
      const out = [];
      for (const [moduleKey, action] of specs) {
        const column = ACTION_COLUMN[action];
        if (!column) { out.push(false); continue; }
        const grants = await identityCache.getGrants(client, {
          role_ids: req.user.role_ids, module: moduleKey,
        });
        out.push(grants.some((g) => g[column] === true));
      }
      return out;
    });
  } catch {
    /* @silent:storage — a hint that cannot be resolved is shown as "ask an
       administrator", which is the safe direction: it under-offers links
       rather than offering one into a refusal. */
    return specs.map(() => false);
  }
}

module.exports = { requirePermission, requireCapability, requireCeo, readPermissions };
