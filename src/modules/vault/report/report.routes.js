"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./report.controller");
const validator = require("./report.validator");
module.exports = { basePath: "/reports", feature: "reporting", router: makeRouter({ controller, validator }) };
