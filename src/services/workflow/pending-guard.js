/**
 * "Users must always go through the approval workflow" (audit finding W4).
 *
 * Every approvable document kept its own transition route — `POST
 * /purchase-orders/:id/transition` → APPROVED_LOCKED and six siblings — gated
 * only by `requirePermission(<own module>, 'approve')` and calling the same
 * transition function the approval dispatcher calls, with no check for a live
 * chain. So a tenant could design a three-step chain with thresholds and one
 * person could skip all of it with one click; `purchase_order.service.js` even
 * records that person as `approver_id`. It was not API-only: the PO list screen
 * renders the button (features/procurement/pages.tsx).
 *
 * The guard is deliberately narrow: it refuses only while the entity has a
 * PENDING task. It does NOT refuse when no workflow is bound, because plenty of
 * tenants have no chain configured for a given document and removing the manual
 * path outright would leave those records unactionable — trading a control gap
 * for a stuck document, which is the failure mode this audit kept finding. The
 * chain, when there is one, is now the only way through it.
 *
 * Call from the SERVICE, not the route: the route knows the id, the service
 * knows the entity_ref convention, and the dispatcher must be able to complete
 * the same transition without tripping the guard (it passes `viaChain`).
 */
"use strict";

const { AppError } = require("../../utils/errors");

/**
 * Throw if `entityRef` has a pending approval task.
 *
 * @param {object}  client     tenant client (approval_task is env data)
 * @param {string}  entityRef  "purchase_order:<uuid>"
 * @param {object}  [opts]
 * @param {boolean} [opts.viaChain]  set by on-approved dispatch — the chain
 *   completing IS the approval, so it must not be blocked by its own task.
 * @param {string}  [opts.what]      noun for the message ("purchase order")
 */
async function assertNoPendingChain(client, entityRef, { viaChain = false, what = "record" } = {}) {
  if (viaChain) return;
  const { rows } = await client.query(
    "SELECT approval_task_id FROM approval_task WHERE entity_ref = $1 AND status = 'PENDING' LIMIT 1",
    [entityRef],
  );
  if (rows.length) {
    throw new AppError(
      "APPROVAL_PENDING",
      `This ${what} is in an approval chain — decide it from Approvals rather than approving it directly`,
      422,
    );
  }
}

module.exports = { assertNoPendingChain };
