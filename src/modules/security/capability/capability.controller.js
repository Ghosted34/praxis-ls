"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Capabilities are identity data (env-independent) — pin to the live schema.
module.exports = makeController(require("./capability.service"), "Capability", { identity: true });
