"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./smart_receivables.service"), "Receipt");
