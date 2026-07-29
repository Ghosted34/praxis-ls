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
  "dossier.created": { action: "view", title: "New dossier opened" },
  "delivery_note.created": { action: "view", title: "Delivery note created" },
  "transit_order.created": { action: "view", title: "Transit order created" },

  // ── Sales & CRM ──
  "lead.created": { action: "view", title: "New lead" },
  "lead.converted": { action: "view", title: "Lead converted" },
  "contact_enquiry.created": { action: "view", title: "New enquiry" },
  "opportunity.won": { action: "view", title: "Opportunity won" },
  "opportunity.lost": { action: "view", title: "Opportunity lost" },
  "proposal.accepted": { action: "view", title: "Proposal accepted" },

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
    let sent = 0;
    for (const userId of recipients) {
      if (actorUserId && userId === actorUserId) continue;
      await service.notify(client, {
        userId, eventTypeKey, title: cfg.title, body, entityRef, category, priority: cfg.priority || "NORMAL",
      });
      sent += 1;
    }
    return sent;
  } catch (err) {
    logger.warn({ err: err.message, eventTypeKey }, "[notify-events] failed");
    return 0;
  }
}

module.exports = { onEvent, NOTIFIABLE };
