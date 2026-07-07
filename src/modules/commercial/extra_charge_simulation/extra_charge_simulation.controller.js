"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./extra_charge_simulation.service"), "Extra-charge simulation");
