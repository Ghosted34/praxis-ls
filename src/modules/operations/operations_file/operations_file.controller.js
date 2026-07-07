"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./operations_file.service"), "Operation file");
