/**
 * Scope membership — `user_scope`, the join that puts a person in the
 * organigramme.
 *
 * The table has existed since 0110_rbac.sql:75 and was READ in exactly one place
 * (identity-cache.getUserScopeIds) and WRITTEN nowhere: no endpoint, no UI, no
 * script. So `getUserScopeIds` always returned [], `req.scope_ids` was always
 * null, every user was implicitly unrestricted, and the scope tree an admin
 * could build had no attachment point (audit finding A1). Approval steps that
 * name a scope are unactionable until a person can be put in one — this is that
 * missing half.
 *
 * Lives beside the generic scope CRUD rather than inside it because makeRepo /
 * makeService model one table, and this is the join.
 *
 * Membership is IDENTITY data, like roles and grants: the controller runs it on
 * req.identityDb (scope.controller.js is makeController(..., { identity: true }))
 * so a user's org position is the same under LIVE and TEST. Writing it to the
 * env schema would give someone a different place in the company depending on
 * which environment toggle they had flipped.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const identityCache = require("../../../shared/cache/identity-cache");
const { emitEvent, audit } = require("../../../shared/events/emit");
const events = require("./scope.events");

const M = events.MODULE;
const ref = (scopeId) => `scope:${scopeId}`;

/** Users assigned to a scope, with enough identity to render a picker. */
async function listMembers(client, scopeId) {
  const { rows } = await client.query(
    `SELECT u.user_id, u.full_name, u.email, u.status
       FROM user_scope us
       JOIN app_user u ON u.user_id = us.user_id
      WHERE us.scope_id = $1
      ORDER BY u.full_name ASC`,
    [scopeId],
  );
  return rows;
}

/** Every scope a given user sits in — the inverse view, for a user detail page. */
async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT s.scope_id, s.code, s.name, s.parent_scope_id, s.entity_id
       FROM user_scope us
       JOIN scope s ON s.scope_id = us.scope_id
      WHERE us.user_id = $1
      ORDER BY s.name ASC`,
    [userId],
  );
  return rows;
}

/**
 * Put a user in a scope. Idempotent — re-assigning is a no-op rather than a
 * 23505, because the UI cannot always know the current state and a duplicate
 * click must not read as an error.
 *
 * Cache invalidation is not optional here: `getUserScopeIds` is cached for 30s
 * and the approval eligibility check reads the closure derived from it, so a
 * stale entry means someone can act on a scope they were just removed from.
 * Same reasoning as permission.service.
 */
async function addMember(client, { scopeId, userId, actor = {} }) {
  const scope = await client.query("SELECT scope_id FROM scope WHERE scope_id = $1", [scopeId]);
  if (!scope.rows.length) throw new AppError("NOT_FOUND", "Scope not found", 404);
  const user = await client.query("SELECT user_id FROM app_user WHERE user_id = $1", [userId]);
  if (!user.rows.length) throw new AppError("NOT_FOUND", "User not found", 404);

  const { rows } = await client.query(
    `INSERT INTO user_scope (user_id, scope_id) VALUES ($1, $2)
     ON CONFLICT (user_id, scope_id) DO NOTHING
     RETURNING user_id`,
    [userId, scopeId],
  );
  const added = rows.length > 0;

  if (added) {
    await emitEvent(client, {
      eventTypeKey: events.UPDATED, moduleKey: M, entityRef: ref(scopeId), actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id, action: events.UPDATED, moduleKey: M, entityRef: ref(scopeId),
      after: { assigned_user_id: userId, scope_id: scopeId },
    });
  }
  await identityCache.invalidateGrants();
  return { assigned: true, already: !added };
}

/** Remove a user from a scope. */
async function removeMember(client, { scopeId, userId, actor = {} }) {
  const { rowCount } = await client.query(
    "DELETE FROM user_scope WHERE user_id = $1 AND scope_id = $2",
    [userId, scopeId],
  );
  if (!rowCount) throw new AppError("NOT_FOUND", "That user is not assigned to this scope", 404);

  await emitEvent(client, {
    eventTypeKey: events.UPDATED, moduleKey: M, entityRef: ref(scopeId), actorUserId: actor.user_id,
  });
  await audit(client, {
    actorUserId: actor.user_id, action: events.UPDATED, moduleKey: M, entityRef: ref(scopeId),
    before: { assigned_user_id: userId, scope_id: scopeId },
  });
  await identityCache.invalidateGrants();
  return { removed: true };
}

/**
 * The whole tree in one call, for the organigramme view. Returns flat rows with
 * a member count per node; the client assembles the tree from parent_scope_id
 * (it needs the flat list anyway for the step picker, and one query beats N).
 *
 * `member_count` is deliberately a count and not the members themselves — the
 * diagram renders names only when a node is opened, and a tenant with a few
 * hundred users shouldn't ship all of them to draw a chart.
 */
async function tree(client) {
  const { rows } = await client.query(
    `SELECT s.scope_id, s.code, s.name, s.parent_scope_id, s.entity_id,
            e.code AS entity_code,
            (SELECT count(*)::int FROM user_scope us WHERE us.scope_id = s.scope_id) AS member_count
       FROM scope s
       LEFT JOIN corporate_entity e ON e.entity_id = s.entity_id
      ORDER BY s.name ASC`,
  );
  return rows;
}

/**
 * The tree as a PICKER: names only, no member counts, no entity join.
 *
 * `tree()` above is the administrative view and is gated on MOD-67 (IAM). This
 * one is not, and must not be: since 0490 "department" IS a scope, so the
 * ordinary Sales user raising a purchase request, the HR clerk adding an
 * employee and the manager posting a vacancy all need to read this list. Gating
 * it on IAM meant they got "You don't have permission to do this" on a form
 * field, which is both wrong and unfixable from their side.
 *
 * Safe to expose to any authenticated user: these are the department and branch
 * names printed on the forms they already fill in. Deliberately does NOT include
 * `member_count` — who sits where is org information and stays behind MOD-67.
 */
async function options(client) {
  const { rows } = await client.query(
    `SELECT scope_id, code, name, parent_scope_id
       FROM scope
      ORDER BY name ASC`,
  );
  return rows;
}

/**
 * Corporate entities AS THE SCOPE TABLE SEES THEM.
 *
 * `scope` is identity data and is written through req.identityDb, so
 * `scope.entity_id REFERENCES corporate_entity(entity_id)` always resolves
 * against the LIVE schema. The ordinary /entities endpoint reads through
 * req.tenantDb — the env-selected schema — so under TEST it lists
 * `sandbox.corporate_entity`, whose rows have different UUIDs. Picking one there
 * and saving produced a raw 23503 ("Referenced record not found") that named
 * nothing useful.
 *
 * Hence this: the scope screen's entity picker reads the same schema the FK will
 * check. Same shape as the master-data list so the client can swap endpoints
 * without changing its type.
 */
async function entities(client) {
  const { rows } = await client.query(
    `SELECT entity_id, code, legal_name
       FROM corporate_entity
      WHERE is_active = true
      ORDER BY code ASC`,
  );
  return rows;
}

/** Does this entity exist in the identity schema? Used for a clear error. */
async function entityExists(client, entityId) {
  if (!entityId) return true; // tenant-wide scope — nothing to check
  const { rows } = await client.query(
    "SELECT 1 FROM corporate_entity WHERE entity_id = $1 LIMIT 1",
    [entityId],
  );
  return rows.length > 0;
}

module.exports = { listMembers, listForUser, addMember, removeMember, tree, options, entities, entityExists };
