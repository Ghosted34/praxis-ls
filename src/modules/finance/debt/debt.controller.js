"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./debt.service"), "Debt engagement");
