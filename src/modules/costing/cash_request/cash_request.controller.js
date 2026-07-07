"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./cash_request.service"), "Cash request");
