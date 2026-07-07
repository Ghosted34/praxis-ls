"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./cash_request.repo");
const events = require("./cash_request.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "cash_request", events });
