"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./final_invoice.repo");
const events = require("./final_invoice.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "final_invoice", events, beforeCreate: (d) => ({ ...d, type: "FINAL" }) });
