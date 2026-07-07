"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./lead.repo");
const events = require("./lead.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "lead", events });
