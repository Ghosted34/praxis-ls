"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./cash_request.controller");
const validator = require("./cash_request.validator");
module.exports = { basePath: "/cash-requests", feature: "costing", router: makeRouter({ controller, validator }) };
