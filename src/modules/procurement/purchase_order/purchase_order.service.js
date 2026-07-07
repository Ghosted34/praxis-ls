"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./purchase_order.repo");
const events = require("./purchase_order.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "purchase_order", events });
