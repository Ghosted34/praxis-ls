"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./corporate_entity.repo");
const events = require("./corporate_entity.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "entity", events });
