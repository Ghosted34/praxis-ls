"use strict";
const service = require("./proposal.service");
const validator = require("./proposal.validator");
module.exports = {
  entity: "proposal", module_key: "MOD-23", screens: [],
  reads: [
    { key: "list_proposals", service: (c, p) => service.list(c, p), describe: "List proposals (filter status/client)." },
    { key: "get_proposal", service: (c, p) => service.get(c, p.id || p), describe: "Get a proposal with lines + narrative." },
  ],
  writes: [
    { key: "draft_proposal", service: (c, p) => service.createDraft(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-23", action: "create" }, confirm: true, describe: "Draft a proposal (AI-assisted; human review before send)." },
    { key: "transition_proposal", service: (c, p) => service.transition(c, { id: p.proposal_id, to: p.to, entityId: p.entity_id }), schema: validator.schemas.aiTransition, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Review/send/reject a proposal by id." },
    { key: "accept_proposal", service: (c, p) => service.accept(c, { id: p.proposal_id, createQuotation: p.create_quotation, entityId: p.entity_id }), schema: validator.schemas.aiAccept, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Accept a sent proposal (by id; optionally create a quotation)." },
  ],
};
