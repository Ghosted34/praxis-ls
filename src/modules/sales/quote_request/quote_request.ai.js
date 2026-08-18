"use strict";
const service = require("./quote_request.service");
const validator = require("./quote_request.validator");
module.exports = {
  entity: "quote_request",
  module_key: "MOD-20",
  screens: [],
  reads: [
    { key: "list_quote_requests", service: (c, p) => service.list(c, p).then((r) => ({ rows: r.rows, total: r.total, kpi: r.kpi })), permission: { module: "MOD-20", action: "view" }, describe: "List intake quote requests. Returns rows + total + the KPI tiles, one per intake status plus TOTAL, which partition the filtered set." },
    { key: "get_quote_request", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-20", action: "view" }, describe: "Get a quote request by id, with attachments." },
  ],
  writes: [
    { key: "create_quote_request", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-20", action: "create" }, confirm: true, describe: "Create a new quote request. `incoterm` is required. Public reference is allocated from the tenant's numbering scheme in the same transaction." },
    { key: "transition_quote_request", service: (c, p) => service.transition(c, { id: p.quote_request_id, to: p.to }), schema: validator.schemas.aiTransition, permission: { module: "MOD-20", action: "edit" }, confirm: true, describe: "Advance a quote request by id through the intake lifecycle (RECEIVED -> UNDER_REVIEW -> QUOTED -> CONVERTED_TO_OPPORTUNITY)." },
    { key: "convert_quote_request", service: (c, p) => service.convertToOpportunity(c, { id: p.quote_request_id, opportunity: p.opportunity }), schema: validator.schemas.aiConvert, permission: { module: "MOD-20", action: "approve" }, confirm: true, describe: "Convert a quote request into an opportunity in the pipeline. The opportunity starts in NEW; staff move it from there." },
  ],
};
