"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./fuel_log.repo");
const events = require("./fuel_log.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "fuel_log", events });
