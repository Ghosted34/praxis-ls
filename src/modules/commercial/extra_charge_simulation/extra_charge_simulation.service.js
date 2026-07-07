"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./extra_charge_simulation.repo");
const events = require("./extra_charge_simulation.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "extra_charge_simulation", events });
