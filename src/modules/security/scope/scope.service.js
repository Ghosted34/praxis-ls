"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./scope.repo");
const events = require("./scope.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "scope", events });
