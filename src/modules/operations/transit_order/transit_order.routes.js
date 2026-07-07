"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./transit_order.controller");
const validator = require("./transit_order.validator");
module.exports = { basePath: "/transit-orders", feature: "operations", router: makeRouter({ controller, validator }) };
