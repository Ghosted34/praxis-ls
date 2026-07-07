"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./transit_order.repo");
const events = require("./transit_order.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "transit_order", events });
