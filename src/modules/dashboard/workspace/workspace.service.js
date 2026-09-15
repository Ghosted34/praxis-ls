"use strict";
const repo = require("./workspace.repo");
const reconService = require("../../costing/dossier_reconciliation/dossier_reconciliation.service");

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
  // Cash to account for (owner decision Q10, guide §6.5): receipts the signed-in
  // user took and still owes paperwork on. Fed by GET /costing/reconciliations/owed
  // which already keys on cash_request_payment.received_by. Best-effort: a
  // missing module must not 500 the dashboard.
  const owed = user && user.user_id
    ? await reconService.receiptsOwed(client, { userId: user.user_id }).catch(() => ({ count: 0, total_ttc: 0, items: [] }))
    : { count: 0, total_ttc: 0, items: [] };
  return {
    approvals_awaiting_me: await repo.approvals(client, v),
    unread_notifications: user && user.user_id ? await repo.unread(client, user.user_id) : [],
    receipts_owed: owed,
  };
}
module.exports = { mine };
