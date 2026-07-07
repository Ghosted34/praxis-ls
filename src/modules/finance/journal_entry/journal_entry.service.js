"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./journal_entry.repo");
const events = require("./journal_entry.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "journal_entry", events });
