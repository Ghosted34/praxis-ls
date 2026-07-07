"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./vehicle_compliance.controller");
const validator = require("./vehicle_compliance.validator");
module.exports = { basePath: "/vehicle-compliance", feature: "fleet", router: makeRouter({ controller, validator }) };
