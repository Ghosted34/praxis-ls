"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./outbound.repo");
const events = require("./outbound.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "outbound", events });
