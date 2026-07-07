"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./hr_contract.repo");
const events = require("./hr_contract.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "hr_contract", events });
