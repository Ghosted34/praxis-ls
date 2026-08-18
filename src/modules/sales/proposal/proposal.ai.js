"use strict";
const service = require("./proposal.service");
const validator = require("./proposal.validator");
const generator = require("./proposal.generator");
module.exports = {
  entity: "proposal", module_key: "MOD-23", screens: [],
  reads: [
    { key: "list_proposals", service: (c, p) => service.list(c, p), permission: { module: "MOD-23", action: "view" }, describe: "List proposals (filter status/client)." },
    { key: "get_proposal", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-23", action: "view" }, describe: "Get a proposal with lines + narrative." },
  ],
  writes: [
    { key: "generate_proposal", service: (c,p) => generator.generate(c,{proposalId:p.proposal_id,input:p}), schema: validator.schemas.aiGenerate, permission: { module: "MOD-23", action: "edit" }, confirm: true, describe: "Generate a grounded bilingual narrative for a draft proposal." },
    { key: "share_proposal", service: (c,p) => service.share(c,{id:p.proposal_id,expiresInDays:p.expires_in_days||30}), schema: validator.schemas.aiShare, permission: { module: "MOD-23", action: "edit" }, confirm: true, describe: "Mint an expiring public link for a sent proposal." },
    { key: "draft_proposal", service: (c, p) => service.createDraft(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-23", action: "create" }, confirm: true, describe: "Draft a proposal (AI-assisted; human review before send)." },
    { key: "transition_proposal", service: (c, p) => service.transition(c, { id: p.proposal_id, to: p.to, entityId: p.entity_id }), schema: validator.schemas.aiTransition, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Advance a proposal by id one step along DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED. States cannot be skipped: from DRAFT the only move is IN_REVIEW (review before sending); SENT/reject come after review." },
    { key: "accept_proposal", service: (c, p) => service.accept(c, { id: p.proposal_id, createQuotation: p.create_quotation, entityId: p.entity_id }), schema: validator.schemas.aiAccept, permission: { module: "MOD-23", action: "approve" }, confirm: true, describe: "Accept a sent proposal (by id; optionally create a quotation)." },
  ],
};
