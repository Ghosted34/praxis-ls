"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./transit_order.service"), "Transit order");
