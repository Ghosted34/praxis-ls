"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./outbound.service"), "Outbound order");
