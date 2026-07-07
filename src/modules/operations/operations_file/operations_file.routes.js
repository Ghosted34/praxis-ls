"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./operations_file.controller");
const validator = require("./operations_file.validator");
module.exports = { basePath: "/operations", feature: "operations", router: makeRouter({ controller, validator }) };
