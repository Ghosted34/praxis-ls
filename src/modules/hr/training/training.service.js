"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./training.repo");
const events = require("./training.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "training", events });
