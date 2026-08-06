"use strict";
/**
 * My Workspace reads. Every query is best-effort — one broken panel must not
 * 500 the page — but see the warning on `safe`.
 */

/**
 * Swallow query errors so one bad panel doesn't take the page down.
 *
 * KNOWN COST: a failing query becomes indistinguishable from an empty result.
 * "Nothing awaiting your validation or approval" is what you see both when
 * there is genuinely nothing pending AND when the query threw — a column that
 * doesn't exist yet because a migration hasn't run, for instance. If a panel
 * looks suspiciously empty, check the server log before believing it.
 */
async function safe(client, sql, params) {
  try { const { rows } = await client.query(sql, params); return rows; } catch { return []; }
}

/**
 * Approvals awaiting THIS user.
 *
 * It previously accepted `roleIds` and ignored it — the SQL selected every
 * PENDING task in the tenant with no filter at all, so a panel titled
 * "Awaiting me" was really "everything pending, anywhere" (the workspace half
 * of audit finding W12; the same bug lived in workflow.repo.listApprovals).
 *
 * Now mirrors the eligibility the decision route enforces:
 *   · a task assigned to a role the caller doesn't hold isn't theirs;
 *   · a task for a module they can't approve isn't theirs;
 *   · NULL on either means "open to anyone" and stays visible — that describes
 *     every step built before the designer grew role/scope pickers, so
 *     filtering them out would empty a queue that has real work in it;
 *   · the CEO sees everything, consistent with the RBAC bypass.
 */
const approvals = (c, { roleIds = [], moduleKeys = [], isCeo = false } = {}) => {
  if (isCeo) {
    return safe(c, "SELECT * FROM approval_task WHERE status='PENDING' ORDER BY created_at DESC LIMIT 50");
  }
  return safe(
    c,
    `SELECT * FROM approval_task
      WHERE status='PENDING'
        AND (assigned_role_id IS NULL OR assigned_role_id = ANY($1::uuid[]))
        AND (module_key IS NULL OR module_key = ANY($2::citext[]))
      ORDER BY created_at DESC LIMIT 50`,
    [roleIds, moduleKeys],
  );
};

// `recentEvents` used to live here — a tenant-wide `SELECT * FROM event_log`
// that fed the Workspace's "Recent activity" panel. That surface moved to the
// Control Tower as `<RecentActivity>` on top of the self-scoped
// /audit/my-feed endpoint, so this repo no longer needs to answer the
// question. Removing it also lets us stop reading event_log for a UI panel
// (that table is drivers of workflows and notifications; treating it as a
// display list was always incidental).
const unread = (c, userId) => safe(c, "SELECT * FROM notification WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50", [userId]);

module.exports = { approvals, unread };
