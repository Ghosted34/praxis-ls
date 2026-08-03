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
    { key: "transition_proposal", service: (c, p) => service.transition(c, { id: p.proposal_id, to: p.to, entityId: p.entity_id }), schema: validator.schemas.aiTransition, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Advance a proposal by id one step along DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED. States cannot be skipped: from DRAFT the only move is IN_REVIEW (review before sending); SENT/reject come after review." },
    { key: "accept_proposal", service: (c, p) => service.accept(c, { id: p.proposal_id, createQuotation: p.create_quotation, entityId: p.entity_id }), schema: validator.schemas.aiAccept, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Accept a sent proposal (by id; optionally create a quotation)." },
  ],
};
