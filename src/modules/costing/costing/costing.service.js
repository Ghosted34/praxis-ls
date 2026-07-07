"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./costing.repo");
const events = require("./costing.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "costing", events });
