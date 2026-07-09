"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./capability.repo");
const events = require("./capability.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "capability", events });
