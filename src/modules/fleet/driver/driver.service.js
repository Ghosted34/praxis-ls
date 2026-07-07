"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./driver.repo");
const events = require("./driver.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "driver", events });
