"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./tax_declaration.service"), "Tax declaration");
