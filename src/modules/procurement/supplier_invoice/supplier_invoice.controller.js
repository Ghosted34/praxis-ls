"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./supplier_invoice.service"), "Supplier invoice");
