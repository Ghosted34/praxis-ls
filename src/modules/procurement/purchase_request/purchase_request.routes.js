"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./purchase_request.controller");
const validator = require("./purchase_request.validator");
module.exports = { basePath: "/purchase-requests", feature: "procurement", router: makeRouter({ controller, validator }) };
