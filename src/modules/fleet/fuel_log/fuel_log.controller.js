"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./fuel_log.service"), "Fuel log");
