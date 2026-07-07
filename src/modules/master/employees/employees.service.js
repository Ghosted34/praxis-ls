"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./employees.repo");
const events = require("./employees.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "employee", events });
