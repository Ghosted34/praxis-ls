"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./proposal.repo");
const events = require("./proposal.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "proposal", events });
