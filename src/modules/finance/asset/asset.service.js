"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./asset.repo");
const events = require("./asset.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "asset", events });
