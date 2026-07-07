"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./tax_jurisdiction.service"), "Tax jurisdiction");
