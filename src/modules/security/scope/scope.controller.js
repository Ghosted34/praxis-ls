// ai:none — org scopes (branches/departments) as an access boundary. Membership decides what the caller — and therefore the AI — may read.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Scopes are identity data (env-independent) — pin to the live schema.
module.exports = makeController(require("./scope.service"), "Scope", { identity: true });
