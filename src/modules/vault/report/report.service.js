"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./report.repo");
const events = require("./report.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "report", events });
