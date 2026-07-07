"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./opportunity.repo");
const events = require("./opportunity.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "opportunity", events });
