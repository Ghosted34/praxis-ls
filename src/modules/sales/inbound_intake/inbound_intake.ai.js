"use strict";
const service = require("./inbound_intake.service");
const validator = require("./inbound_intake.validator");
module.exports = {
  entity: "contact_enquiry", module_key: "MOD-25", screens: [],
  reads: [
    { key: "list_enquiries", service: (c, p) => service.listEnquiries(c, p), describe: "List inbound contact enquiries." },
    { key: "list_partnership_requests", service: (c, p) => service.listPartnerships(c, p), describe: "List partnership requests." },
  ],
  writes: [
    { key: "triage_enquiry", service: (c, p) => service.triageEnquiry(c, p), schema: validator.schemas.triage, permission: { module: "MOD-25", action: "edit" }, confirm: true, describe: "Triage an enquiry (optionally convert to a lead)." },
    { key: "review_partnership", service: (c, p) => service.reviewPartnership(c, p), schema: validator.schemas.review, permission: { module: "MOD-25", action: "edit" }, confirm: true, describe: "Review a partnership request." },
  ],
};
