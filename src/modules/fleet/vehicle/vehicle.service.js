"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./vehicle.repo");
const events = require("./vehicle.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "vehicle", events });
