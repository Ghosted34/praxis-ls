"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Scopes are identity data (env-independent) — pin to the live schema.
module.exports = makeController(require("./scope.service"), "Scope", { identity: true });
