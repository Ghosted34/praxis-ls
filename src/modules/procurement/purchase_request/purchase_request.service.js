"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./purchase_request.repo");
const events = require("./purchase_request.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "purchase_request", events });
