"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./notification.repo");
const events = require("./notification.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "notification", events });
