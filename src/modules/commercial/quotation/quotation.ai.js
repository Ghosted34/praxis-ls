"use strict";
const service = require("./quotation.service");
const validator = require("./quotation.validator");
module.exports = {
  entity: "quotation", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_quotations", service: (c, p) => service.list(c, p), describe: "List quotations (filter status/client/dossier)." },
    { key: "get_quotation", service: (c, p) => service.get(c, p.id || p), describe: "Get a quotation with lines + totals." },
  ],
  writes: [
    { key: "draft_quotation", service: (c, p) => service.createDraft(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-27", action: "create" }, confirm: true, describe: "Draft a quotation (lines + totals)." },
    { key: "transition_quotation", service: (c, p) => service.transition(c, p), schema: validator.schemas.transition, permission: { module: "MOD-27", action: "approve" }, confirm: true, describe: "Send/reject/expire a quotation." },
    { key: "accept_quotation", service: (c, p) => service.accept(c, p), schema: validator.schemas.accept, permission: { module: "MOD-27", action: "approve" }, confirm: true, describe: "Accept a sent quotation (optionally convert to a final invoice)." },
  ],
};
