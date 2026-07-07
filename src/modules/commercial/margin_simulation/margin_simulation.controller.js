"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./margin_simulation.service"), "Margin simulation");
