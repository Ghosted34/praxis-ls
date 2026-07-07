"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./cost_tracking.service"), "Cost entry");
