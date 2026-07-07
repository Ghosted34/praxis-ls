"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./hr_contract.service"), "Contract");
