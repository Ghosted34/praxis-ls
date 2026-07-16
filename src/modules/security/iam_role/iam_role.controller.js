"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Roles are identity data (env-independent) — pin to the live schema.
module.exports = makeController(require("./iam_role.service"), "Role", { identity: true });
