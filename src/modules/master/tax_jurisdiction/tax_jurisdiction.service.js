"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./tax_jurisdiction.repo");
const events = require("./tax_jurisdiction.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "tax_jurisdiction", events });
