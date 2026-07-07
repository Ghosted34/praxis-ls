"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./lead.controller");
const validator = require("./lead.validator");
module.exports = { basePath: "/leads", feature: "sales.crm", router: makeRouter({ controller, validator }) };
