"use strict";
const service = require("./inbound_intake.service");
const validator = require("./inbound_intake.validator");

/**
 * The module's operations in the assistant's function-calling catalogue.
 * NOT an AI generator — see Block A.
 *
 * ON THE COST/MARGIN RULE: `contact_enquiry` carries no cost, price or margin
 * column, so there is nothing for a SELECT to exclude here. Stated rather than
 * left silent, so the next person to add a column to this table knows the rule
 * applies to it and that the exclusion belongs in the SQL, not after it.
 *
 * `respond_to_enquiry` is confirm: true and always will be. It sends an email
 * to a member of the public, in the tenant's name, and that is not a thing an
 * assistant may do without a human reading the words first.
 */
module.exports = {
  entity: "contact_enquiry",
  module_key: "MOD-25",
  screens: [],
  reads: [
    {
      key: "list_enquiries",
      service: (c, p) => service.listEnquiries(c, p).then((r) => ({ rows: r.rows, total: r.total, kpi: r.kpi })),
      describe: "List contact enquiries. Returns rows + total + the KPI tiles (TOTAL, NEW, READ, RESPONDED, CLOSED), which partition the filtered set. Filter by status, enquiry_type (GENERAL_ENQUIRY | PARTNERSHIP | CAREERS | MEDIA), source, triaged=true|false, month/year, or a free-text q.",
    },
    {
      key: "get_enquiry",
      service: (c, p) => service.getEnquiry(c, p.id || p),
      describe: "Get one contact enquiry by id, with every reply attempt and its delivery outcome.",
    },
  ],
  writes: [
    {
      key: "transition_enquiry",
      service: (c, p) => service.transition(c, { id: p.contact_enquiry_id, to: p.to }),
      schema: validator.schemas.aiTransition,
      permission: { module: "MOD-25", action: "edit" },
      confirm: true,
      describe: "Move an enquiry through the correspondence lifecycle (NEW -> READ -> RESPONDED -> CLOSED; CLOSED reopens to READ). Does not send anything.",
    },
    {
      key: "respond_to_enquiry",
      service: (c, p) => service.respond(c, { id: p.contact_enquiry_id, body: p.body, subject: p.subject || null }),
      schema: validator.schemas.aiRespond,
      permission: { module: "MOD-25", action: "edit" },
      confirm: true,
      describe: "Email a reply to the person who sent the enquiry and mark it RESPONDED. The enquiry only moves if the send succeeds. Always human-confirmed.",
    },
    {
      key: "triage_enquiry",
      service: (c, p) => service.triageEnquiry(c, { id: p.contact_enquiry_id, toLead: p.to_lead === true, toPartnership: p.to_partnership === true, close: p.close === true }),
      schema: validator.schemas.aiTriage,
      permission: { module: "MOD-25", action: "edit" },
      confirm: true,
      describe: "Route an enquiry into the funnel: raise a lead, and/or raise a partnership request (which also classifies it as PARTNERSHIP). Triage does not mark the enquiry answered.",
    },
  ],
};
