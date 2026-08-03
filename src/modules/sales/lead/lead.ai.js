"use strict";
const service = require("./lead.service");
const validator = require("./lead.validator");
module.exports = {
  entity: "lead", module_key: "MOD-20", screens: [],
  reads: [
    { key: "list_leads", service: (c, p) => service.list(c, p), describe: "List sales leads (filter status/owner)." },
    { key: "get_lead", service: (c, p) => service.get(c, p.id || p), describe: "Get a lead by id." },
  ],
  writes: [
    { key: "create_lead", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-20", action: "create" }, confirm: true, describe: "Capture a new lead." },
    { key: "transition_lead", service: (c, p) => service.transition(c, { id: p.lead_id, to: p.to }), schema: validator.schemas.aiTransition, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Advance a lead by id to CONTACTED/QUALIFIED/LOST." },
    { key: "convert_lead", service: (c, p) => service.convert(c, { id: p.lead_id, clientData: p.client }), schema: validator.schemas.aiConvert, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Convert a qualified lead (by id) into a client." },
  ],
};
