"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./audit_ledger.service"), "Audit entry");
