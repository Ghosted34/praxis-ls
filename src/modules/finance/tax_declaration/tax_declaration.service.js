"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./tax_declaration.repo");
const events = require("./tax_declaration.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "tax_declaration", events });
