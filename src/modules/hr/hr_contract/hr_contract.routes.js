"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./hr_contract.controller");
const validator = require("./hr_contract.validator");
module.exports = { basePath: "/contracts", feature: null, router: makeRouter({ controller, validator }) };
