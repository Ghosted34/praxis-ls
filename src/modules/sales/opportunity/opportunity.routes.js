"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./opportunity.controller");
const validator = require("./opportunity.validator");
module.exports = { basePath: "/opportunities", feature: "sales.crm", router: makeRouter({ controller, validator }) };
