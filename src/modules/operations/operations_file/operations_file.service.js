"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./operations_file.repo");
const events = require("./operations_file.events");
const genRef = () => `OP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "dossier", events, beforeCreate: (d) => ({ ...d, ref: d.ref || genRef(), status: d.status || "OPEN" }) });
