"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./setting.controller");
const validator = require("./setting.validator");
module.exports = { basePath: "/settings", feature: null, router: makeRouter({ controller, validator }) };
