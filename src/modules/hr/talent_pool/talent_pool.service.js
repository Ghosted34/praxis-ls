"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./talent_pool.repo");
const events = require("./talent_pool.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "talent_pool", events });
