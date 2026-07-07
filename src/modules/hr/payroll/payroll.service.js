"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./payroll.repo");
const events = require("./payroll.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "payroll", events });
