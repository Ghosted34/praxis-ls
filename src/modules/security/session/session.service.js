"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./session.repo");
const events = require("./session.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "session", events });
