/**
 * role_kpi_config data access. SQL only, per CONVENTIONS — and it runs on the
 * IDENTITY (live) client: the `role` table it hangs off is identity data, read
 * by the same pinning `iam_role`'s controller uses. Business-schema roles do
 * not get their own band config — one arrangement per role, both modes, is
 * the D5 doctrine applied to the role side of the feature.
 */
"use strict";

async function get(client, roleId) {
  const { rows } = await client.query(
    "SELECT role_id, scope_ids, default_ids, locked_ids, updated_at FROM role_kpi_config WHERE role_id = $1",
    [roleId],
  );
  return rows[0] || null;
}

/**
 * The configs for a USER's roles, in the order the resolver merges them.
 *
 * `user_role` stores no position column, so "earlier role wins" is made
 * deterministic by creation order of the roles themselves — the oldest role a
 * user holds leads the band. That is a real ordering with a real meaning (the
 * senior/first appointment leads), which beats an ORDER BY nothing that would
 * shuffle a user's band between requests.
 */
async function getForRoles(client, roleIds) {
  if (!roleIds || !roleIds.length) return [];
  const { rows } = await client.query(
    `SELECT k.role_id, k.scope_ids, k.default_ids, k.locked_ids, r.code AS role_code, r.name AS role_name
       FROM role_kpi_config k
       JOIN role r ON r.role_id = k.role_id
      WHERE k.role_id = ANY($1::uuid[])
      ORDER BY r.created_at ASC`,
    [roleIds],
  );
  return rows;
}

async function upsert(client, { roleId, scopeIds, defaultIds, lockedIds }) {
  const { rows } = await client.query(
    `INSERT INTO role_kpi_config (role_id, scope_ids, default_ids, locked_ids, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (role_id) DO UPDATE SET
       scope_ids = EXCLUDED.scope_ids,
       default_ids = EXCLUDED.default_ids,
       locked_ids = EXCLUDED.locked_ids,
       updated_at = now()
     RETURNING role_id, scope_ids, default_ids, locked_ids, updated_at`,
    [roleId, scopeIds, defaultIds, lockedIds],
  );
  return rows[0];
}

async function clear(client, roleId) {
  await client.query("DELETE FROM role_kpi_config WHERE role_id = $1", [roleId]);
}

/**
 * Rewrite one row's arrays — the prune path (see service). Returns the row so
 * the caller can report what the prune cost the role.
 */
async function replaceArrays(client, { roleId, scopeIds, defaultIds, lockedIds }) {
  const { rows } = await client.query(
    `UPDATE role_kpi_config
        SET scope_ids = $2, default_ids = $3, locked_ids = $4, updated_at = now()
      WHERE role_id = $1
      RETURNING role_id, scope_ids, default_ids, locked_ids, updated_at`,
    [roleId, scopeIds, defaultIds, lockedIds],
  );
  return rows[0];
}

module.exports = { get, getForRoles, upsert, clear, replaceArrays };
