"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./final_invoice.service"), "Final invoice");
