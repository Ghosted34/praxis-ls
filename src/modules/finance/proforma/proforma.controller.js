"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./proforma.service"), "Proforma invoice");
