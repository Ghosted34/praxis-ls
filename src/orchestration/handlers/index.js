/**
 * Central registration of orchestration handlers (Plan A). Requiring this module
 * registers every handler with the registry; the dispatcher requires it at load.
 * Mirrors the `*.ai.js` manifest convention. The event vocabulary was audited
 * against every module's *.events.js (see doc/SYSTEM_CONNECTIVITY_AND_ORCHESTRATION.md).
 */
"use strict";

const { register } = require("../registry");
const invalidateSignaturesOnEntity = require("./entity-updated-invalidate-signatures");

const dossierMilestones = require("./dossier-created-instantiate-milestones");
const advanceMilestone = require("./advance-milestone-on-op-event");

// ── Sales → Operations ──
register(require("./opportunity-won-open-dossier"));            // opportunity.won → open dossier
register(dossierMilestones);                                    // dossier.created → stamp milestone template
register({ eventKey: "dossier.updated", handlerKey: "dossier.updated:instantiate-milestones", feature: null, run: dossierMilestones.run }); // late service_type

// ── Operations → Finance (money flow) ──
register(require("./costing-approved-draft-invoice"));          // costing.approved → draft final invoice (async backstop; sync primary in costing.service)
register(require("./supplier-invoice-posted-cost-entry"));      // supplier_invoice.posted → dossier cost_entry (links existing GL entry)
register(require("./fuel-log-created-dossier-cost"));            // fuel_log.created → dossier cost (recordCost, settings-gated)

// ── Operations lifecycle ──
register({ eventKey: "transit_order.created", handlerKey: "transit_order.created:advance-milestone", feature: null, run: advanceMilestone.run });
// The declaration being LODGED is what T1_LODGED actually means (10693 re-points
// the seeded stage onto it); `created` above only ever meant a draft existed.
register({ eventKey: "transit_order.lodged", handlerKey: "transit_order.lodged:advance-milestone", feature: null, run: advanceMilestone.run });
register({ eventKey: "delivery_note.created", handlerKey: "delivery_note.created:advance-milestone", feature: null, run: advanceMilestone.run });
// The seeded chains close their final-invoice stage on invoice.issued, so the
// tail of every file completes itself instead of waiting for a manual tick.
register({ eventKey: "invoice.issued", handlerKey: "invoice.issued:advance-milestone", feature: null, run: advanceMilestone.run });
register(require("./milestone-completed-signal"));              // milestone.advanced → dossier.milestones_completed (all done)

// ── Own direct costs → dossier margin (analytical; no GL double-post) ──
register(require("./fleet-dispatch-returned-driver-labour")); // fleet_dispatch RETURNED → driver-time to 661 dossier-tagged (PRD §6.7/§1093)
register(require("./work-order-done-dossier-cost"));          // work_order DONE → dossier maintenance cost
register(require("./outbound-dispatched-handling-cost"));     // outbound DISPATCHED → dossier handling cost (opt-in via wms.handling_rate)

// ── Finance lifecycle ──
register(require("./receipt-posted-collected-signal"));       // receipt.posted → dossier.fully_collected (all billed invoices settled)

// ── Mail signatures (PR-2) ──
register(require("./employee-updated-invalidate-signature"));
register(invalidateSignaturesOnEntity);
register({
  eventKey: "entity.letterhead_updated",
  handlerKey: "entity.letterhead_updated:invalidate-signatures",
  feature: null,
  run: invalidateSignaturesOnEntity.run,
});

// ── Resolved decisions — intentionally NOT auto-wired (not pending) ──
//  Payroll run → GL-only (company-wide 661/664). Dossier labour is DRIVER TIME,
//    attributed per-job from fleet_dispatch above (PRD §6.7/§1093) — a blanket
//    split off the payroll run would be an accounting fiction.
//  Commercial documents are deliberate human steps, so they stay operator-driven:
//   • proposal.accepted → quotation — opt-in `accept({createQuotation})` (pricing is a decision).
//   • quotation.accepted → invoice  — opt-in `accept({convert})`; the dossier's DRAFT invoice
//       is already produced by costing.approved (one-draft-per-dossier).
//   • purchase_request.approved → PO — the buyer selects supplier/terms when raising the PO.
//   • lead.converted → opportunity   — already handled in-service by lead conversion.

module.exports = {};
