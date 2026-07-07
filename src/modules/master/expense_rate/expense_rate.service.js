"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./expense_rate.repo");
const events = require("./expense_rate.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "expense_rate", events });
