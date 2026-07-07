"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./debt.repo");
const events = require("./debt.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "debt", events });
