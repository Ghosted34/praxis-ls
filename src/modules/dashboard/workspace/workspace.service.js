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
  return {
    approvals_awaiting_me: await repo.approvals(client, v),
    recent_activity: await repo.recentEvents(client),
    unread_notifications: user && user.user_id ? await repo.unread(client, user.user_id) : [],
  };
}
module.exports = { mine };
