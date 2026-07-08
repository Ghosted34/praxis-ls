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

/** Call after a user is deactivated, role-reassigned, or session-revoked. */
async function invalidateUser(userId) {
  const redis = safeRedis();
  if (redis) await redis.del(authKey(userId)).catch(() => {});
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

module.exports = { getAuthUser, getGrants, invalidateUser, invalidateGrants };
