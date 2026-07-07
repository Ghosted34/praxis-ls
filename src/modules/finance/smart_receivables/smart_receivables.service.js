"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./smart_receivables.repo");
const events = require("./smart_receivables.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "smart_receivables", events });
