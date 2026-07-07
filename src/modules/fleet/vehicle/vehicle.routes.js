"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./vehicle.controller");
const validator = require("./vehicle.validator");
module.exports = { basePath: "/vehicles", feature: "fleet", router: makeRouter({ controller, validator }) };
