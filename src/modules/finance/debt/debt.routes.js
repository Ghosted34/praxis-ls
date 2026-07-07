"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./debt.controller");
const validator = require("./debt.validator");
module.exports = { basePath: "/financing", feature: "finance.debt", router: makeRouter({ controller, validator }) };
