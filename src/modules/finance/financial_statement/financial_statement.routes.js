"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./financial_statement.controller");
const validator = require("./financial_statement.validator");
module.exports = { basePath: "/statements", feature: "accounting.statements", router: makeRouter({ controller, validator }) };
