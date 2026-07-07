"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./margin_simulation.repo");
const events = require("./margin_simulation.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "margin_simulation", events });
