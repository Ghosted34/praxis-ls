"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./chart_of_accounts.repo");
const events = require("./chart_of_accounts.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "account", events });
