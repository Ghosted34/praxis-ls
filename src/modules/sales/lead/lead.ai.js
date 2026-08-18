"use strict";
const service = require("./lead.service");
const validator = require("./lead.validator");
module.exports = {
  entity: "lead",
  module_key: "MOD-20",
  screens: [],
  reads: [
    { key: "list_leads", service: (c, p) => service.list(c, p), permission: { module: "MOD-20", action: "view" }, describe: "List sales leads (filter status/owner/intake_channel)." },
    { key: "get_lead", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-20", action: "view" }, describe: "Get a lead by id." },
  ],
  writes: [
    { key: "create_lead", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-20", action: "create" }, confirm: true, describe: "Capture a new lead. F6: accepts country, address, NIU, RCCM, intake_channel, client_type_hint, payment_terms_days so the eventual convert has every fact Finance needs." },
    { key: "transition_lead", service: (c, p) => service.transition(c, { id: p.lead_id, to: p.to }), schema: validator.schemas.aiTransition, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Advance a lead by id to CONTACTED/QUALIFIED/LOST." },
    { key: "convert_lead", service: (c, p) => service.convert(c, { id: p.lead_id, clientData: p.client }), schema: validator.schemas.aiConvert, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Convert a qualified lead (by id) into a client. The `client` block MUST carry client_type and payment_terms_days — the legacy's silent fallback to BOTH/30 is gone." },
  ],
};
