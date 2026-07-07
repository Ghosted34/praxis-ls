"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./audit_ledger.repo");
const events = require("./audit_ledger.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "audit_ledger", events });
