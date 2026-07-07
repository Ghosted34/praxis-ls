"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./goods_received.service"), "Goods received");
