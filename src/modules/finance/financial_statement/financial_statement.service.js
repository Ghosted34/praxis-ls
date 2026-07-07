"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./financial_statement.repo");
const events = require("./financial_statement.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "financial_statement", events });
