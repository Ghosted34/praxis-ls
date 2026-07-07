"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./vacancy.repo");
const events = require("./vacancy.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "vacancy", events });
