"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./expense_rate.controller");
const validator = require("./expense_rate.validator");
module.exports = { basePath: "/expense-rates", feature: null, router: makeRouter({ controller, validator }) };
