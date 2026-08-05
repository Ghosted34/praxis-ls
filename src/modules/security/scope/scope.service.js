/**
 * scope (RBAC-affecting). Wraps generic CRUD so every write invalidates the
 * identity/grant cache — a role/scope/visibility/capability change must be
 * reflected by requirePermission on the NEXT request, not after the 30s TTL
 * (stale RBAC is a security bug). Mirrors permission.service.js.
 *
 * Also guards the shape of the tree itself. `parent_scope_id` is the
 * organigramme, and it is now load-bearing: identity-cache.getUserScopeClosure()
 * recurses over it to decide who may act on a scoped approval step. Nothing
 * previously stopped a caller making a scope its own ancestor — the validator was
 * `passthrough` and the FE only excluded the node being edited from its parent
 * dropdown, which catches A→A and not A→B→A (audit finding A4).
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const identityCache = require("../../../shared/cache/identity-cache");
const { AppError } = require("../../../utils/errors");
const repo = require("./scope.repo");
const events = require("./scope.events");
const members = require("./scope.members");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "scope", events, deleteMode: "hard"});

/**
 * Reject a parent that would put `scopeId` inside its own ancestry.
 *
 * Walks UP from the proposed parent: if we reach `scopeId`, attaching would
 * close a loop. `UNION` terminates on an already-cyclic tree (it discards rows
 * it has seen) and the depth cap is a second brake, so this is safe to run even
 * against data that predates the guard.
 *
 * No-ops when there is no parent (a root) or no id (a create — a row that does
 * not exist yet cannot be its own ancestor).
 */
async function assertNoCycle(client, scopeId, parentScopeId) {
  if (!parentScopeId || !scopeId) return;
  if (parentScopeId === scopeId) {
    throw new AppError("SCOPE_CYCLE", "A scope cannot be its own parent", 422);
  }
  const { rows } = await client.query(
    `WITH RECURSIVE up AS (
       SELECT scope_id, parent_scope_id, 0 AS depth
         FROM scope WHERE scope_id = $1
       UNION
       SELECT s.scope_id, s.parent_scope_id, up.depth + 1
         FROM scope s JOIN up ON s.scope_id = up.parent_scope_id
        WHERE up.depth < 32
     )
     SELECT 1 FROM up WHERE scope_id = $2 LIMIT 1`,
    [parentScopeId, scopeId],
  );
  if (rows.length) {
    throw new AppError(
      "SCOPE_CYCLE",
      "That parent sits beneath this scope — it would make the organigramme loop",
      422,
    );
  }
}

/**
 * The entity must exist in the schema the FK will check — the identity (live)
 * schema, because scope is identity data. Without this the caller got a raw
 * 23503 "Referenced record not found", which is true and tells them nothing:
 * the entity they picked plainly exists, just in the sandbox schema they happen
 * to be viewing. See scope.members.entities.
 */
async function assertEntityResolvable(client, entityId) {
  if (!entityId) return;
  if (!(await members.entityExists(client, entityId))) {
    throw new AppError(
      "ENTITY_NOT_IN_IDENTITY_SCHEMA",
      "That corporate entity doesn't exist in the live schema, where scopes are stored. " +
        "If you're in TEST mode, switch to LIVE or leave the entity blank for a tenant-wide scope.",
      422,
    );
  }
}

module.exports = {
  ...base,
  assertNoCycle,
  assertEntityResolvable,
  async create(client, args) {
    await assertEntityResolvable(client, args && args.data ? args.data.entity_id : null);
    const r = await base.create(client, args);
    await identityCache.invalidateGrants();
    // PERF S4: the closure cache is keyed on a tree version; any scope or
    // user_scope write retires every cached closure for this tenant.
    await identityCache.bumpScopeVersion();
    return r;
  },
  async update(client, args) {
    // args is { id, patch, actor } — see shared/crud/resource.js makeService.
    const parent = args && args.patch ? args.patch.parent_scope_id : null;
    if (parent) await assertNoCycle(client, args.id, parent);
    await assertEntityResolvable(client, args && args.patch ? args.patch.entity_id : null);
    const r = await base.update(client, args);
    await identityCache.invalidateGrants();
    // PERF S4: the closure cache is keyed on a tree version; any scope or
    // user_scope write retires every cached closure for this tenant.
    await identityCache.bumpScopeVersion();
    return r;
  },
  async archive(client, args) {
    const r = await base.archive(client, args);
    await identityCache.invalidateGrants();
    // PERF S4: the closure cache is keyed on a tree version; any scope or
    // user_scope write retires every cached closure for this tenant.
    await identityCache.bumpScopeVersion();
    return r;
  },
};
