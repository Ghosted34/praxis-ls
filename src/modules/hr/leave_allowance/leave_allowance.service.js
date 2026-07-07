"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./leave_allowance.repo");
const events = require("./leave_allowance.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "leave_allowance", events });
