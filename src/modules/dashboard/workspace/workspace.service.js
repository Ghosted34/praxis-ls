"use strict";
const repo = require("./workspace.repo");
const reconService = require("../../costing/dossier_reconciliation/dossier_reconciliation.service");

/**
 * My Workspace.
 *
 * The focused reads are intentionally separate. Today can show an unavailable
 * approvals panel while unread alerts continue to work, instead of converting
 * one failed query into a convincing empty dashboard.
 */
async function approvals(client, user, viewer = null) {
  const v = viewer || {
    userId: user && user.user_id ? user.user_id : null,
    roleIds: user && user.role_ids ? user.role_ids : [],
    moduleKeys: [],
    isCeo: !!(user && user.is_ceo),
  };
  return repo.approvals(client, v);
}

async function alerts(client, user) {
  return user && user.user_id ? repo.unread(client, user.user_id) : [];
}

async function mine(client, user, viewer = null) {
  // Cash to account for is a separate product queue and remains best-effort: a
  // missing costing module must not prevent the Workspace facade from serving
  // approvals and alerts.
  const owed = user && user.user_id
    ? await reconService.receiptsOwed(client, { userId: user.user_id }).catch(() => ({ count: 0, total_ttc: 0, items: [] }))
    : { count: 0, total_ttc: 0, items: [] };
  return {
    approvals_awaiting_me: await approvals(client, user, viewer),
    unread_notifications: await alerts(client, user),
    receipts_owed: owed,
  };
}

module.exports = { mine, approvals, alerts };
