"use strict";
const service = require("./marketing_campaign.service");
const validator = require("./marketing_campaign.validator");
module.exports = {
  entity: "marketing_campaign", module_key: "MOD-22", screens: [],
  reads: [
    { key: "list_campaigns", service: (c, p) => service.list(c, p), describe: "List marketing campaigns." },
    { key: "list_subscribers", service: (c, p) => service.subscribers(c, p), describe: "List active newsletter subscribers." },
  ],
  writes: [
    { key: "create_campaign", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-22", action: "create" }, confirm: true, describe: "Create a marketing campaign." },
    { key: "transition_campaign", service: (c, p) => service.transition(c, p), schema: validator.schemas.transition, permission: { module: "MOD-22", action: "edit" }, confirm: true, describe: "Activate/pause/end a campaign." },
  ],
};
