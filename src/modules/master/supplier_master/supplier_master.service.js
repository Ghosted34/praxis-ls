"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./supplier_master.repo");
const events = require("./supplier_master.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "supplier", events });
