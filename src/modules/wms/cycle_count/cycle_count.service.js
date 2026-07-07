"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./cycle_count.repo");
const events = require("./cycle_count.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "cycle_count", events });
