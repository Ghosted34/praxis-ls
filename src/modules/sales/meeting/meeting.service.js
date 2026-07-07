"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./meeting.repo");
const events = require("./meeting.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "meeting", events });
