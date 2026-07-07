"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./payroll.controller");
const validator = require("./payroll.validator");
module.exports = { basePath: "/payroll", feature: null, router: makeRouter({ controller, validator }) };
