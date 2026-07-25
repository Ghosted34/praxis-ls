/**
 * costing.approved → draft final invoice (Plan A, Phase 1) — ASYNC BACKSTOP.
 *
 * Per A7 #3 the primary handoff is SYNCHRONOUS: costing.setStatus(APPROVE) opens
 * the DRAFT invoice in-request via finalInvoice.ensureDraftForCosting. This
 * handler runs the SAME idempotent function off the outbox, so if the sync path
 * failed (e.g. transient), the draft is still created — and no-ops when it already
 * exists. One source of truth, no divergence, no double-create.
 */
"use strict";

const finalInvoice = require("../../modules/finance/final_invoice/final_invoice.service");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "costing.approved",
  handlerKey: "costing.approved:draft-invoice",
  feature: null,
  async run(client, event) {
    const costingId = idFromRef(event.entity_ref, "costing");
    if (!costingId) return { skipped: "no costing ref" };
    return finalInvoice.ensureDraftForCosting(client, costingId);
  },
};
