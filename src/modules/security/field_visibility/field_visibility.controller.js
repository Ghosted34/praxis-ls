"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./field_visibility.service"), "Field visibility rule");
