/**
 * Domain-event notifications — turns selected business events into notifications
 * for the people entitled to that area. Recipients are resolved by RBAC: active
 * users whose roles grant the configured permission (default: view) on the
 * event's module. So "an invoice was posted" reaches the users who can work with
 * invoices, and nobody else.
 *
 * Driven by a CURATED allowlist (NOTIFIABLE) so this is never a firehose — only
 * high-signal events notify, and each recipient's per-category preference still
 * applies (in-app by default, email if opted in). Everything is best-effort:
 * a notification failure must never affect the business operation that emitted
 * the event. Called from shared/events/emit.js on the caller's transaction.
 */
"use strict";

const { logger } = require("../../config/logger");
const { categoryFor } = require("./categories");

/**
 * event_type_key → { action, title, priority? }. `action` is the permission that
 * defines the audience (see notification.repo.recipientsWithPermission);
 * `priority` defaults to NORMAL. Keep this list small and high-signal per area.
 */
const NOTIFIABLE = {
  // ── Finance ──
  "payment.received": { action: "view", title: "Payment received" },
  "invoice.posted": { action: "view", title: "Invoice posted" },
  "invoice.issued": { action: "view", title: "Invoice issued" },
  "credit_note.posted": { action: "view", title: "Credit note posted" },
  "journal.reversed": { action: "view", title: "Journal entry reversed" },
  "period.closed": { action: "view", title: "Accounting period closed" },

  // ── Operations & logistics ──
  "dossier.created": { action: "view", title: "New operations file opened" },
  "delivery_note.created": { action: "view", title: "Delivery note created" },
  "transit_order.created": { action: "view", title: "Transit order created" },

  // ── Sales & CRM ──
  "lead.created": { action: "view", title: "New lead" },
  "lead.converted": { action: "view", title: "Lead converted" },
  "contact_enquiry.created": { action: "view", title: "New enquiry" },
  "opportunity.won": { action: "view", title: "Opportunity won" },
  "opportunity.lost": { action: "view", title: "Opportunity lost" },
  "proposal.accepted": { action: "view", title: "Proposal accepted" },

  /*
   * ── Approvals & disbursement (12771, owner Q20) ──
   *
   * The chain events already notify the people a task is waiting on
   * (`notify-approvals`). These are the MONEY events, and until now not one
   * `cash_request.*` or `costing.*` key was in this list — so a disbursement
   * was emitted, audited, and reached nobody unless a tenant happened to have
   * bound a workflow.
   *
   * Broadcast to the module audience rather than to the approval path: "who was
   * paid what against my file" is wanted by operations and finance people who
   * are not signatories. Safe to broadcast here for two reasons that do not
   * hold elsewhere — the audience is RBAC-resolved, so it cannot reach anyone
   * without MOD-49 view, and the whole category is one switch in Preferences.
   *
   * Category comes from `DOMAIN_TO_CATEGORY`, which already maps `cash_request`
   * and `disbursal` to "approvals"; nothing here has to name it.
   */
  "costing.approved": { action: "view", title: "Costing approved" },
  "cash_request.approved": { action: "view", title: "Cash request approved" },
  "cash_request.partially_disbursed": { action: "view", title: "Cash request part paid" },
  "cash_request.disbursed": { action: "view", title: "Cash disbursed" },
  "cash_request.closed_short": { action: "view", title: "Cash request settled short" },
  "cash_request.justified": { action: "view", title: "Cash request justified" },
  // The one that is not routine: money the treasury approved and the requester
  // now has to answer for.
  "cash_request.rejected": { action: "view", title: "Cash request rejected", priority: "HIGH" },

  // ── Procurement ──
  "goods_received.created": { action: "view", title: "Goods received" },
  "supplier_invoice.posted": { action: "view", title: "Supplier invoice posted" },

  // ── HR ──
  "payroll.posted": { action: "view", title: "Payroll posted" },

  // ── Fleet compliance expiries (high-signal deadlines) ──
  "vehicle.insurance.expiring": { action: "view", title: "Vehicle insurance expiring", priority: "HIGH" },
  "vehicle.visite_technique.expiring": { action: "view", title: "Vehicle inspection expiring", priority: "HIGH" },
  "driver.license.expiring": { action: "view", title: "Driver licence expiring", priority: "HIGH" },
  "incident.status_changed": { action: "view", title: "Incident updated" },

  // ── Compliance & documents ──
  "compliance_flag.raised": { action: "view", title: "Compliance flag raised", priority: "HIGH" },
  "document.signed": { action: "view", title: "Document signed" },
  /*
   * Verification-portal signals (guide §5.5).
   *
   * `scanned_new_ip` is emitted ONLY when the tenant has switched
   * signature_policy.notify_on_scan on — the gate is in the portal service, not
   * here, because it is a tenant setting rather than a property of the event.
   * For a tenant issuing hundreds of delivery notes this would otherwise be
   * noise, and a channel that is noise gets muted wholesale.
   *
   * `scan_anomaly` is HIGH and is not subject to that toggle: one signature
   * verified more than the threshold allows in a rolling hour is either under
   * audit or being shopped around, and both are worth knowing either way.
   */
  "document_signature.scanned_new_ip": { action: "view", title: "Document verified from a new address" },
  "document_signature.scan_anomaly": { action: "view", title: "Unusual verification activity", priority: "HIGH" },

  // ── HR lifecycle ──
  "leave_allowance.decided": { action: "view", title: "Leave request decided" },
  "hr_contract.status_changed": { action: "view", title: "Contract status changed" },

  // ── Assets ──
  "asset.disposed": { action: "view", title: "Asset disposed" },
};

function shortEntity(entityRef) {
  const [type, id] = String(entityRef || "").split(":");
  if (!type) return "";
  const label = type.replace(/_/g, " ");
  const shortId = id && id.length > 8 ? id.slice(0, 8) : id;
  return shortId ? `${label} ${shortId}` : label;
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function fmtAmount(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat("en-US").format(n)} XAF`;
}

/**
 * Raise notifications for one emitted event, if it's on the allowlist. Notifies
 * the module's permission-holders (excluding the actor). Returns the count sent.
 */
async function onEvent(client, { eventTypeKey, moduleKey, entityRef = null, actorUserId = null, payload = {} }) {
  const cfg = NOTIFIABLE[eventTypeKey];
  if (!cfg || !moduleKey) return 0;
  try {
    const repo = require("../../modules/notification/notification.repo");
    const service = require("../../modules/notification/notification.service");
    const recipients = await repo.recipientsWithPermission(client, moduleKey, cfg.action);
    const amt = fmtAmount(payload && (payload.amount_xaf ?? payload.amount ?? payload.total_ttc));
    const ent = shortEntity(entityRef);
    const body = `${cfg.title}${ent ? ` — ${cap(ent)}` : ""}${amt ? ` (${amt})` : ""}.`;
    const category = categoryFor(eventTypeKey);
    // PERF S5: one batched call instead of a loop of ~5 queries per recipient.
    // The actor is excluded here rather than inside notifyMany — "do not tell
    // me about my own action" is this fan-out's rule, not a property of
    // notification delivery.
    const targets = recipients.filter((u) => !(actorUserId && u === actorUserId));
      // `return await`, NOT `return`. In an async function `try { return p; }`
    // does NOT catch p's rejection — the return adopts the promise and the
    // rejection escapes the handler entirely. This function is documented and
    // relied upon as BEST-EFFORT (an event fan-out must never fail the business
    // operation that produced the event), and it was not: a notifyMany failure
    // propagated straight out to the caller. Found by the one test in
    // notify-events.test.js that was still asserting the real contract.
    return await service.notifyMany(client, targets, {
      eventTypeKey, title: cfg.title, body, entityRef, category, priority: cfg.priority || "NORMAL",
    });
  } catch (err) {
    logger.warn({ err, eventTypeKey }, "[notify-events] failed");
    return 0;
  }
}

module.exports = { onEvent, NOTIFIABLE };
