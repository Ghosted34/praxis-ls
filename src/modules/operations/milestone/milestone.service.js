"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./milestone.repo");
const events = require("./milestone.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "milestone", events });
