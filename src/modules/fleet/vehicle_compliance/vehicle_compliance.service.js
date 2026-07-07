"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./vehicle_compliance.repo");
const events = require("./vehicle_compliance.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "vehicle_compliance", events });
