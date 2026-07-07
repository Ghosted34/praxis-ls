"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./compliance_flag.repo");
const events = require("./compliance_flag.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "compliance_flag", events });
