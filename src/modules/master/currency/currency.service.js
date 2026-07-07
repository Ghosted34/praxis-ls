"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./currency.repo");
const events = require("./currency.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "currency", events });
