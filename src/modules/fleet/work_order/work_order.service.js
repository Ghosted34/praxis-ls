"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./work_order.repo");
const events = require("./work_order.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "work_order", events });
