"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./cycle_count.service"), "Cycle count");
