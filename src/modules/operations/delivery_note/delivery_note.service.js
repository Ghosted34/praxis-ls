"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./delivery_note.repo");
const events = require("./delivery_note.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "delivery_note", events });
