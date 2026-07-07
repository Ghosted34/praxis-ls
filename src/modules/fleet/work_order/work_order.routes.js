"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./work_order.controller");
const validator = require("./work_order.validator");
module.exports = { basePath: "/work-orders", feature: "fleet.maintenance", router: makeRouter({ controller, validator }) };
