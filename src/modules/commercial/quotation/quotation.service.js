"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./quotation.repo");
const events = require("./quotation.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "quotation", events });
