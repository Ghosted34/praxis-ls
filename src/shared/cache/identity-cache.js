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

/**
 * PERF S9. Every cache key is namespaced by tenant.
 *
 * The keyspace was flat — `identity:grants:<roleIds>:<module>` — and
 * `invalidateGrants()` deleted `identity:grants:*` across the whole Redis
 * instance. So ONE tenant editing ONE permission flushed the RBAC cache for
 * EVERY tenant on the deployment, producing a synchronised cache-miss stampede
 * straight into the connection pools that S1/S2 are about.
 *
 * There was never a cross-tenant data leak — role ids are per-tenant
 * gen_random_uuid(), so keys cannot collide — but the invalidation blast radius
 * was global.
 *
 * The tenant comes from the ambient request context, which tenantContext
 * already populates. Background work has no tenant; those entries land under
 * `_` and are flushed by the global sweep, which is correct because a job that
 * does not know its tenant cannot make a narrower claim.
 */
const requestContext = require("../../config/request-context");

function tenantNs() {
  const ctx = requestContext.get();
  return (ctx && ctx.tenant) || "_";
}

const authKey = (userId) => `identity:${tenantNs()}:auth:${userId}`;
const grantsKey = (roleIds, moduleKey) =>
  `identity:${tenantNs()}:grants:${[...new Set(roleIds)].sort().join(",")}:${moduleKey}`;
const scopeKey = (userId) => `identity:${tenantNs()}:scope:${userId}`;
const capsKey = (userId) => `identity:${tenantNs()}:caps:${userId}`;

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
            u.employee_id,
            u.avatar_ref,
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
 * Every module_key the given roles hold `approve` on.
 *
 * Used by the approvals inbox to show a caller only the tasks they could act on
 * (W12), matching the per-task gate the act route applies (W3). Not cached: it
 * is one indexed read per inbox load, and the grant cache is keyed by
 * (roles, module) — a per-role-set key would be a third cache shape to
 * invalidate correctly, which is how stale RBAC happens.
 */
async function getApprovableModules(client, roleIds = []) {
  if (!roleIds || !roleIds.length) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT module_key FROM permission
      WHERE role_id = ANY($1::uuid[]) AND can_approve = true`,
    [roleIds],
  );
  return rows.map((r) => r.module_key);
}

/**
 * PERF S4. Monotonic version of the tenant's scope tree.
 *
 * Folded into every closure cache key, so bumping it retires every cached
 * closure for the tenant in ONE `INCR` — no SCAN, no key enumeration, and no
 * interval during which a stale closure is still readable. That last property
 * is what a per-user invalidation could not give: re-parenting one node changes
 * the closure of every user beneath it, and enumerating those users is exactly
 * the tree walk being avoided.
 *
 * Defaults to 0 when Redis is unreachable, which simply means the key is stable
 * and the 30-second TTL is doing the work on its own — degraded, not wrong.
 */
async function scopeVersion(redis) {
  const v = await redis.get(`identity:${tenantNs()}:scope:version`).catch(() => null);
  return v || "0";
}

/** Call after ANY write to `scope` or `user_scope`. */
async function bumpScopeVersion() {
  const redis = safeRedis();
  if (!redis) return;
  await redis.incr(`identity:${tenantNs()}:scope:version`).catch(() => {});
}

/**
 * Resolve the DOWNWARD closure of a user's scope assignments: every scope they
 * are assigned to, plus everything beneath those nodes in the `parent_scope_id`
 * tree — the organigramme.
 *
 * This is what approval routing needs and `getUserScopeIds` above does not give.
 * A workflow step names the scope the decision belongs to (e.g. the Douala
 * branch); an approver qualifies if they sit at that node **or at an ancestor of
 * it**, because authority flows downward — the regional manager over Douala can
 * approve Douala's work, not the reverse. Expressed from the user's side, that
 * is exactly "is the step's scope inside my closure".
 *
 * CACHED SINCE PERF S4, and the original reason for not caching is worth keeping
 * because it was right: this walks a tree whose shape changes when any scope is
 * re-parented, and a cache keyed by USER would leave every descendant user stale
 * for the TTL. The old comment concluded that approval decisions are rare, so
 * the round trip was cheap.
 *
 * That conclusion was wrong about WHERE this runs. `requirePermission` calls it
 * on EVERY permission-gated request, not just approvals — so a recursive CTE ran
 * on essentially every authenticated request in the product, against a
 * `parent_scope_id` column that had no index until migration 0500. The plan
 * showed `Seq Scan on scope … loops=4`: the whole table re-scanned once per
 * recursion level. Measured at 19,510 nodes: 14.78 ms per request, falling to
 * 0.92 ms with the index alone.
 *
 * The fix for the staleness objection is to invalidate on the TREE rather than
 * the USER. A monotonic version counter is folded into the cache key, and any
 * write to `scope` or `user_scope` bumps it — which makes every cached closure
 * in the tenant unreachable at once, in a single INCR, with no scan and no
 * window in which a stale closure can be read. Re-parenting is rare; requests
 * are not. That asymmetry is what makes this safe to cache when a per-user
 * invalidation would not have been.
 *
 * `depth < 32` caps the walk. `UNION` (not UNION ALL) already terminates on a
 * cycle by discarding rows it has seen, but the cap is kept as a second brake:
 * scope has no cycle guard yet (scope.validator.js is passthrough — audit
 * finding A4), so a malformed tree must not be able to spin a request.
 */
async function getUserScopeClosure(client, userId) {
  if (!userId) return [];

  const redis = safeRedis();
  let key = null;
  if (redis) {
    const version = await scopeVersion(redis);
    key = `identity:${tenantNs()}:scope:closure:${version}:${userId}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* corrupt entry — fall through and recompute */
      }
    }
  }

  const { rows } = await client.query(
    `WITH RECURSIVE mine AS (
       SELECT s.scope_id, 0 AS depth
         FROM scope s
         JOIN user_scope us ON us.scope_id = s.scope_id
        WHERE us.user_id = $1
       UNION
       SELECT child.scope_id, mine.depth + 1
         FROM scope child
         JOIN mine ON child.parent_scope_id = mine.scope_id
        WHERE mine.depth < 32
     )
     SELECT scope_id FROM mine`,
    [userId],
  );
  const ids = rows.map((r) => r.scope_id);
  // Same 30 s TTL as the other identity entries. The TTL is the backstop; the
  // version counter is the real invalidation.
  if (redis && key) await redis.set(key, JSON.stringify(ids), "EX", 30).catch(() => {});
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

/**
 * Field-level confidentiality (PRD §7.3): the field_keys the user may NOT see,
 * resolved from `field_visibility` across all their roles (visibility='masked').
 * The response serializer (shared/rbac/field-mask) nulls the mapped properties.
 * Cached under the grants namespace so any field_visibility write (which calls
 * invalidateGrants) flushes it immediately (Watch-the-Watcher).
 */
async function getMaskedFieldKeys(client, userId) {
  if (!userId) return [];
  const redis = safeRedis();
  const key = `identity:${tenantNs()}:grants:fields:${userId}`;
  if (redis) {
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  const { rows } = await client.query(
    `SELECT DISTINCT fv.field_key
       FROM field_visibility fv
       JOIN user_role ur ON ur.role_id = fv.role_id
      WHERE ur.user_id = $1 AND fv.visibility = 'masked'`,
    [userId],
  );
  const keys = rows.map((r) => r.field_key);
  if (redis) await redis.set(key, JSON.stringify(keys), "EX", GRANTS_TTL_S).catch(() => {});
  return keys;
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
/**
 * Delete every key matching `pattern`, without blocking Redis.
 *
 * PERF S9. This used `KEYS`, which is O(N) over the ENTIRE keyspace and blocks
 * the Redis main thread for the duration. The same Redis serves BullMQ,
 * sessions and rate limiting, so a permission edit stalled all of them.
 *
 * `SCAN` is cursor-based and incremental: it never blocks, at the cost of
 * being approximate under concurrent writes. That trade is right here — the
 * entries are 30-second TTL, so a key this misses expires on its own moments
 * later, while a blocked Redis is felt by every request in flight.
 *
 * Deletes in batches because `DEL` with tens of thousands of arguments is
 * itself a long single command — replacing a blocking KEYS with a blocking DEL
 * would have fixed nothing.
 */
async function scanDelete(redis, pattern) {
  let cursor = "0";
  let removed = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500).catch(() => null);
    if (!res) return removed;
    const [next, keys] = res;
    cursor = next;
    if (keys && keys.length) {
      for (let i = 0; i < keys.length; i += 200) {
        // eslint-disable-next-line no-await-in-loop
        await redis.del(...keys.slice(i, i + 200)).catch(() => {});
      }
      removed += keys.length;
    }
  } while (cursor !== "0");
  return removed;
}

/**
 * Flush the grant cache for the CURRENT TENANT only.
 *
 * `allTenants` exists for the one case that genuinely needs it — a platform-
 * level change to the module catalogue — and has to be asked for explicitly,
 * because the old behaviour was to do it always and by accident.
 */
async function invalidateGrants({ allTenants = false } = {}) {
  const redis = safeRedis();
  if (!redis) return;
  const pattern = allTenants ? "identity:*:grants:*" : `identity:${tenantNs()}:grants:*`;
  await scanDelete(redis, pattern);
}

module.exports = {
  getAuthUser,
  getGrants,
  getUserScopeIds,
  getUserScopeClosure,
  getApprovableModules,
  getUserCapabilities,
  getMaskedFieldKeys,
  invalidateUser,
  invalidateGrants,
  bumpScopeVersion,
};
