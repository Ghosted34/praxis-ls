"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./purchase_request.service"), "Purchase request");
