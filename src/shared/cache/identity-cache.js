/**
 * Identity cache — Redis-backed lookups for auth + RBAC, 30 s TTL with
 * best-effort invalidation on user/role/permission changes.
 *
 * THIS FILE WAS MISSING. `src/middleware/auth.js` and `src/middleware/rbac.js`
 * both `require("../shared/cache/identity-cache")` but the module didn't exist
 * anywhere in the repo — every request through either middleware would throw
 * at require-time. See doc/RBAC_SECURITY_KICKOFF.md ("Work Done Already").
 *
 * `app_user` / `role` / `permission` are TENANT tables (schema-per-environment,
 * live/sandbox) — so every lookup here takes the caller's tenant `client`
 * (from `req.tenantDb`), the same convention every repo in the codebase uses.
 * Redis just caches the resolved rows; Postgres stays the source of truth.
 */
"use strict";

const { getClient } = require("../../config/redis");

const AUTH_TTL_S = 30;
const GRANTS_TTL_S = 30;

const authKey = (userId) => `identity:auth:${userId}`;
const grantsKey = (roleIds, moduleKey) =>
  `identity:grants:${[...new Set(roleIds)].sort().join(",")}:${moduleKey}`;
const scopeKey = (userId) => `identity:scope:${userId}`;
const capsKey = (userId) => `identity:caps:${userId}`;

/** Redis is best-effort for this cache — never let a Redis outage break auth. */
function safeRedis() {
  try {
    return getClient();
  } catch {
    return null;
  }
}

/**
 * Resolve the authenticated principal for a JWT `sub` (user_id): identity,
 * status, the role_ids they hold, and whether any held role is the seeded
 * 'CEO' role (role.code = 'CEO' — CEO bypasses RBAC checks by design, PRD §3).
 */
async function getAuthUser(client, userId) {
  if (!userId) return null;
  const redis = safeRedis();
  const key = authKey(userId);

  if (redis) {
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
  }

  const { rows } = await client.query(
    `SELECT u.user_id,
            u.email,
            u.full_name AS display_name,
            u.status,
            COALESCE(
              array_agg(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),
              '{}'
            ) AS role_ids,
            bool_or(r.code = 'CEO') AS is_ceo
     FROM app_user u
     LEFT JOIN user_role ur ON ur.user_id = u.user_id
     LEFT JOIN role r ON r.role_id = ur.role_id
     WHERE u.user_id = $1
     GROUP BY u.user_id`,
    [userId],
  );
  const user = rows[0] || null;

  if (user && redis) {
    await redis.set(key, JSON.stringify(user), "EX", AUTH_TTL_S).catch(() => {});
  }
  return user;
}

/**
 * Resolve the CRUD grant row(s) for a set of role_ids against one module_key
 * (matches `platform.module_catalogue`, e.g. 'MOD-67'). Returns the raw
 * `permission` rows so the caller (rbac.js) decides how to combine them —
 * this file doesn't know about action names, just the schema.
 */
async function getGrants(client, { role_ids, module }) {
  if (!role_ids || role_ids.length === 0) return [];
  const redis = safeRedis();
  const key = grantsKey(role_ids, module);

  if (redis) {
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
  }

  const { rows } = await client.query(
    `SELECT can_create, can_read, can_update, can_delete, can_approve
     FROM permission
     WHERE role_id = ANY($1::uuid[]) AND module_key = $2`,
    [role_ids, module],
  );

  if (redis) {
    await redis.set(key, JSON.stringify(rows), "EX", GRANTS_TTL_S).catch(() => {});
  }
  return rows;
}

/**
 * Resolve the scope_ids (entity/branch access, `scope`/`user_scope`) a user
 * is confined to — the piece rbac.js's requirePermission() previously left
 * unconsulted entirely ("every grant is currently treated as full-module
 * ('all') access"). An empty result means the user has no scope
 * assignments at all, which — to not silently lock out every existing
 * tenant that never bothered assigning scopes — is treated by the caller
 * as unrestricted ('all'), same as today's behavior. Only users who *do*
 * have scope rows get actually confined to them. See doc/WORK_DONE.md.
 */
async function getUserScopeIds(client, userId) {
  const redis = safeRedis();
  const key = scopeKey(userId);

  if (redis) {
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
  }

  const { rows } = await client.query(`SELECT scope_id FROM user_scope WHERE user_id = $1`, [
    userId,
  ]);
  const ids = rows.map((r) => r.scope_id);

  if (redis) {
    await redis.set(key, JSON.stringify(ids), "EX", GRANTS_TTL_S).catch(() => {});
  }
  return ids;
}

/**
 * Resolve the authority overlay a user carries (DB_ARCHITECTURE §4.2 — the
 * segregation-of-duties layer that sits *on top of* the role×module grant
 * matrix): the capability codes from `user_capability` (ISSUER / VALIDATOR /
 * APPROVER / LINE_MANAGER) plus whether any of their roles is flagged
 * `is_line_manager`. Returns `{ capabilities: string[], is_line_manager: bool }`.
 *
 * This is the mechanism the "Line Manager as a capability layered on any role"
 * backlog item needed — the columns (`role.is_line_manager`, the LINE_MANAGER
 * capability code, `user_capability`) existed but nothing resolved them.
 * `middleware/rbac.js`'s requireCapability() consumes this. Which concrete
 * actions a line manager / approver may take is per-module and mostly lands
 * with Phase 2/3 (leave approvals, appraisals, disbursal routing) — this makes
 * the overlay *readable and enforceable*; those modules opt in via
 * requireCapability('APPROVER') etc.
 */
async function getUserCapabilities(client, userId) {
  if (!userId) return { capabilities: [], is_line_manager: false };
  const redis = safeRedis();
  const key = capsKey(userId);

  if (redis) {
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
  }

  const { rows } = await client.query(
    `SELECT
        COALESCE(
          array_agg(DISTINCT c.code) FILTER (WHERE c.code IS NOT NULL),
          '{}'
        ) AS capabilities,
        bool_or(r.is_line_manager) AS role_line_manager
       FROM app_user u
       LEFT JOIN user_capability uc ON uc.user_id = u.user_id
       LEFT JOIN capability c       ON c.capability_id = uc.capability_id
       LEFT JOIN user_role ur       ON ur.user_id = u.user_id
       LEFT JOIN role r             ON r.role_id = ur.role_id
      WHERE u.user_id = $1
      GROUP BY u.user_id`,
    [userId],
  );
  const row = rows[0] || { capabilities: [], role_line_manager: false };
  const capabilities = row.capabilities || [];
  // A user is a line manager if a role flags it OR they hold LINE_MANAGER directly.
  const result = {
    capabilities,
    is_line_manager: row.role_line_manager === true || capabilities.includes("LINE_MANAGER"),
  };

  if (redis) {
    await redis.set(key, JSON.stringify(result), "EX", GRANTS_TTL_S).catch(() => {});
  }
  return result;
}

/** Call after a user is deactivated, role-reassigned, or session-revoked. */
async function invalidateUser(userId) {
  const redis = safeRedis();
  if (redis) await redis.del(authKey(userId), scopeKey(userId), capsKey(userId)).catch(() => {});
}

/**
 * Call after any `permission` / `role` / `capability` write (iam_role,
 * permission, capability, field_visibility services). Grant keys are cheap
 * and short-lived (30 s) so a coarse flush is fine — permission edits are
 * rare and must propagate immediately (Watch-the-Watcher, PRD §5.7).
 */
async function invalidateGrants() {
  const redis = safeRedis();
  if (!redis) return;
  const keys = await redis.keys("identity:grants:*").catch(() => []);
  if (keys.length) await redis.del(...keys).catch(() => {});
}

module.exports = {
  getAuthUser,
  getGrants,
  getUserScopeIds,
  getUserCapabilities,
  invalidateUser,
  invalidateGrants,
};
