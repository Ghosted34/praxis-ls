"use strict";
const repo = require("./workspace.repo");
async function mine(client, user) {
  return {
    approvals_awaiting_me: await repo.approvals(client),
    recent_activity: await repo.recentEvents(client),
    unread_notifications: user && user.user_id ? await repo.unread(client, user.user_id) : [],
  };
}
module.exports = { mine };
