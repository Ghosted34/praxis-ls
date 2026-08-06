"use strict";
const repo = require("./workspace.repo");

/**
 * My Workspace.
 *
 * `viewer` carries the caller's roles and the modules they may approve so the
 * "Awaiting me" panel means what its title says. The controller resolves it on
 * the identity client (roles and grants are identity data). Omitting it falls
 * back to unassigned/unmoduled tasks only rather than to the whole tenant queue
 * — for a panel labelled "awaiting me", showing too little is a smaller lie
 * than showing everyone's work.
 */
async function mine(client, user, viewer = null) {
  const v = viewer || {
    roleIds: user && user.role_ids ? user.role_ids : [],
    moduleKeys: [],
    isCeo: !!(user && user.is_ceo),
  };
  // `recent_activity` was here as `await repo.recentEvents(client)` — a
  // tenant-wide read of `event_log` that the workspace page rendered as
  // "Auth token refreshed · App user c2d39ee8". That surface moved to the
  // Control Tower as `<RecentActivity>` on top of the self-scoped
  // /audit/my-feed endpoint; this shape drops it so the Workspace stays a
  // queue-of-work surface only. `recentEvents` in the repo went with it.
  return {
    approvals_awaiting_me: await repo.approvals(client, v),
    unread_notifications: user && user.user_id ? await repo.unread(client, user.user_id) : [],
  };
}
module.exports = { mine };
