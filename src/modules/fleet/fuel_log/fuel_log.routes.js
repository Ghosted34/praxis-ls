"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./fuel_log.controller");
const validator = require("./fuel_log.validator");
module.exports = { basePath: "/fuel", feature: "fleet", router: makeRouter({ controller, validator }) };
