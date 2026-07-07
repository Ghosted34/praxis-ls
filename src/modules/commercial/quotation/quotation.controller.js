"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./quotation.service"), "Quotation");
