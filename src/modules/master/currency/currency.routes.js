"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./currency.controller");
const validator = require("./currency.validator");
module.exports = { basePath: "/currencies", feature: null, router: makeRouter({ controller, validator }) };
