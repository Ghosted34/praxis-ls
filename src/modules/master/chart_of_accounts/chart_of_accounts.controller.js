"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./chart_of_accounts.service"), "Account");
