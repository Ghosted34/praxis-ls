"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./cost_tracking.controller");
const validator = require("./cost_tracking.validator");
module.exports = { basePath: "/cost-tracking", feature: "costing", router: makeRouter({ controller, validator }) };
