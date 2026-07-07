"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./inbound_intake.repo");
const events = require("./inbound_intake.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "inbound_intake", events });
