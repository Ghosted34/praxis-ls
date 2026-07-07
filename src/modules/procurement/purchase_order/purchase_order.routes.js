"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./purchase_order.controller");
const validator = require("./purchase_order.validator");
module.exports = { basePath: "/purchase-orders", feature: "procurement", router: makeRouter({ controller, validator }) };
