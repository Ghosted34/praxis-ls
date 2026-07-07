"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./cost_tracking.repo");
const events = require("./cost_tracking.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "cost_tracking", events });
