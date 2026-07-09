"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./field_visibility.repo");
const events = require("./field_visibility.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "field_visibility", events });
