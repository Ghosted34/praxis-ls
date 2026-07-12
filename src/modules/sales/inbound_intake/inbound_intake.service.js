/** Inbound intake (MOD-25) — public "Contact Us" enquiries + partnership requests.
 *  Triage converts an enquiry into a lead (via the lead service). SQL in repo. */
"use strict";
const repo = require("./inbound_intake.repo");
const events = require("./inbound_intake.events");
const leadSvc = require("../lead/lead.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function submitEnquiry(client, { data, actor = {} }) {
  const row = await repo.insertEnquiry(client, { name: data.name || null, email: data.email || null, phone: data.phone || null, subject: data.subject || null, message: data.message || null, source: data.source || "WEBSITE", status: "NEW" });
  await emitEvent(client, { eventTypeKey: events.ENQUIRY_CREATED, moduleKey: events.MODULE, entityRef: "contact_enquiry:" + row.contact_enquiry_id, actorUserId: actor.user_id || null });
  return row;
}
/** Triage an enquiry: optionally spin a lead, then TRIAGED/CLOSED. */
async function triageEnquiry(client, { id, toLead = false, close = false, actor = {} }) {
  const e = await repo.getEnquiry(client, id);
  if (!e) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  await client.query("BEGIN");
  try {
    let leadId = e.lead_id;
    if (toLead && !leadId) {
      const lead = await leadSvc.create(client, { data: { company_name: e.name || "Website enquiry", email: e.email, phone: e.phone, source: "WEBSITE", service_interest: e.subject }, actor });
      leadId = lead.lead_id;
    }
    const row = await repo.updEnquiry(client, id, { status: close ? "CLOSED" : "TRIAGED", lead_id: leadId });
    await emitEvent(client, { eventTypeKey: events.ENQUIRY_TRIAGED, moduleKey: events.MODULE, entityRef: "contact_enquiry:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ENQUIRY_TRIAGED, moduleKey: events.MODULE, entityRef: "contact_enquiry:" + id, after: { lead_id: leadId, status: row.status } });
    await client.query("COMMIT");
    return { enquiry: row, lead_id: leadId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function submitPartnership(client, { data, actor = {} }) {
  const row = await repo.insertPartnership(client, { company_name: data.company_name || null, contact_name: data.contact_name || null, email: data.email || null, proposal_text: data.proposal_text || null, status: "NEW" });
  await emitEvent(client, { eventTypeKey: events.PARTNERSHIP_CREATED, moduleKey: events.MODULE, entityRef: "partnership_request:" + row.partnership_request_id, actorUserId: actor.user_id || null });
  return row;
}
async function reviewPartnership(client, { id, status, actor = {} }) {
  const p = await repo.getPartnership(client, id);
  if (!p) throw new AppError("NOT_FOUND", "Partnership request not found", 404);
  const row = await repo.updPartnership(client, id, { status });
  await audit(client, { actorUserId: actor.user_id || null, action: events.PARTNERSHIP_REVIEWED, moduleKey: events.MODULE, entityRef: "partnership_request:" + id, after: row });
  return row;
}
const listEnquiries = (client, q) => repo.listEnquiries(client, q);
const listPartnerships = (client, q) => repo.listPartnerships(client, q);
module.exports = { submitEnquiry, triageEnquiry, submitPartnership, reviewPartnership, listEnquiries, listPartnerships };
