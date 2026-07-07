"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./inbound_intake.controller");
const validator = require("./inbound_intake.validator");
module.exports = { basePath: "/intake", feature: "sales.crm", router: makeRouter({ controller, validator }) };
