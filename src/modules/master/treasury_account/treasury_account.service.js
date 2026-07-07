"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./treasury_account.repo");
const events = require("./treasury_account.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "treasury_account", events });
