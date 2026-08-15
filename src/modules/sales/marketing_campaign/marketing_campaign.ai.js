/**
 * MOD-22 in the assistant's tool catalogue.
 *
 * NOT an AI generator — this file registers the module's operations so the
 * assistant can call the SAME service the screen calls, with the caller's own
 * RBAC (CONVENTIONS.md, "Adding an AI action"). Every write is `confirm: true`,
 * so it is proposed as an action card the user confirms, never executed
 * straight off a chat turn.
 *
 * The approval decision is deliberately ABSENT. "Approve the Q3 campaign" is
 * exactly the sentence a user would try, and exactly the one the assistant must
 * not be able to satisfy: approving a budget is the control this feature adds,
 * and a confirm-gated action card is a weaker record of who approved it than a
 * deliberate click on the campaign — the approver's identity is the point.
 * Recording performance figures IS here, because a weekly "put 43 leads and 4
 * wins on the freight campaign" is the chore the register exists to make cheap.
 */
"use strict";
const service = require("./marketing_campaign.service");
const validator = require("./marketing_campaign.validator");
module.exports = {
  entity: "marketing_campaign", module_key: "MOD-22", screens: ["sales_campaigns"],
  reads: [
    { key: "list_campaigns", service: (c, p) => service.list(c, p), describe: "List marketing campaigns with their budget, targets, recorded performance and the four KPI tiles. Filters: status, platform, target_service, month, year, q." },
    { key: "get_campaign", service: (c, p) => service.get(c, p.campaign_id), describe: "One campaign in full, including cost per lead against both the plan and the recorded figures." },
    { key: "list_subscribers", service: (c, p) => service.subscribers(c, p), describe: "List active newsletter subscribers." },
  ],
  writes: [
    { key: "create_campaign", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-22", action: "create" }, confirm: true, describe: "Create a marketing campaign in DRAFT with its budget and targets." },
    { key: "transition_campaign", service: (c, p) => service.transition(c, { id: p.campaign_id, to: p.to }), schema: validator.schemas.aiTransition, permission: { module: "MOD-22", action: "edit" }, confirm: true, describe: "Submit a campaign for approval, or pause, resume or end a running one. Cannot approve — that is a deliberate act on the campaign itself." },
    { key: "record_campaign_actuals", service: (c, p) => service.update(c, { id: p.campaign_id, patch: p }), schema: validator.schemas.aiRecordActuals, permission: { module: "MOD-22", action: "edit" }, confirm: true, describe: "Record the hand-entered leads, opportunities and deals won from an external ad-manager report. Only accepted once the campaign is running." },
  ],
};
