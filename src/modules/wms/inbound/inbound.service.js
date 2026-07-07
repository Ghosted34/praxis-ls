"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./inbound.repo");
const events = require("./inbound.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "inbound", events });
