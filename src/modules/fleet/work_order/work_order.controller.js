"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./work_order.service"), "Work order");
