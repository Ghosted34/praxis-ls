"use strict";
const { makeService } = require("../../shared/crud/resource");
const repo = require("./smartcomm.repo");
const events = require("./smartcomm.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "smartcomm", events });
