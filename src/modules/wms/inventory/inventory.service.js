"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./inventory.repo");
const events = require("./inventory.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "inventory", events });
