"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./supplier_invoice.repo");
const events = require("./supplier_invoice.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "supplier_invoice", events });
