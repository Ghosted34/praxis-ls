"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./compliance_flag.service"), "Compliance flag");
