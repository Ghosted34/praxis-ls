"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./purchase_order.service"), "Purchase order");
