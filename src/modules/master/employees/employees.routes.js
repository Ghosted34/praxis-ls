"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./employees.controller");
const validator = require("./employees.validator");
module.exports = { basePath: "/employees", feature: null, router: makeRouter({ controller, validator }) };
