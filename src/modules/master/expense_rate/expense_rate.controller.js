"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./expense_rate.service"), "Expense rate");
