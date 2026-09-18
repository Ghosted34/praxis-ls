"use strict";
/**
 * My Workspace reads. Focused panel endpoints let database failures reach the
 * owning panel instead of being turned into a false empty state.
 */

const queryRows = async (client, sql, params) => {
  const { rows } = await client.query(sql, params);
  return rows;
};

/**
 * Approvals awaiting THIS user.
 *
 * Mirrors the eligibility the approval decision route enforces:
 *   - a task assigned to a role the caller does not hold is not theirs;
 *   - a task assigned directly to another user is not theirs;
 *   - a task for a module they cannot approve is not theirs;
 *   - NULL assignment or module means "open to anyone";
 *   - the CEO sees everything, consistent with the RBAC bypass.
 */
const approvals = (c, { userId = null, roleIds = [], moduleKeys = [], isCeo = false } = {}) => {
  if (isCeo) {
    return queryRows(c, "SELECT * FROM approval_task WHERE status='PENDING' ORDER BY created_at DESC LIMIT 50");
  }
  return queryRows(
    c,
    `SELECT * FROM approval_task
      WHERE status='PENDING'
        AND (assigned_role_id IS NULL OR assigned_role_id = ANY($1::uuid[]))
        AND (assigned_user_id IS NULL OR assigned_user_id = $2)
        AND (module_key IS NULL OR module_key = ANY($3::citext[]))
      ORDER BY created_at DESC LIMIT 50`,
    [roleIds, userId, moduleKeys],
  );
};

const unread = (c, userId) =>
  queryRows(
    c,
    "SELECT * FROM notification WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50",
    [userId],
  );

module.exports = { approvals, unread };
