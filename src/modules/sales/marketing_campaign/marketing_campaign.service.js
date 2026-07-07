"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./marketing_campaign.repo");
const events = require("./marketing_campaign.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "marketing_campaign", events });
