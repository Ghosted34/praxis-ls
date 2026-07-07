"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./warehouse_location.repo");
const events = require("./warehouse_location.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "warehouse_location", events });
