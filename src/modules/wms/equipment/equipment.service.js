"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./equipment.repo");
const events = require("./equipment.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "equipment", events });
