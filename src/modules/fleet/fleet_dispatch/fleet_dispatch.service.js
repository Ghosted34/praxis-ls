"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./fleet_dispatch.repo");
const events = require("./fleet_dispatch.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "fleet_dispatch", events });
