"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./proforma.repo");
const events = require("./proforma.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "proforma", events, beforeCreate: (d) => ({ ...d, type: "PROFORMA" }) });
