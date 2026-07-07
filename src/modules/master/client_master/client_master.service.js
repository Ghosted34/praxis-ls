"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./client_master.repo");
const events = require("./client_master.events");
const genRef = () => `CL-${Date.now().toString(36).toUpperCase()}`;
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "client", events, beforeCreate: (d) => ({ ...d, ref: d.ref || genRef() }) });
