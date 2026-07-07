"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./app_user.repo");
const events = require("./app_user.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "app_user", events });
