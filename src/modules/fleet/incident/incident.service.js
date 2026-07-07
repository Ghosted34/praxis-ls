"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./incident.repo");
const events = require("./incident.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "incident", events });
