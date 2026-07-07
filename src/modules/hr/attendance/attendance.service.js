"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./attendance.repo");
const events = require("./attendance.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "attendance", events });
