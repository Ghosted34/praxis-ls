"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./setting.repo");
const events = require("./setting.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "setting", events });
