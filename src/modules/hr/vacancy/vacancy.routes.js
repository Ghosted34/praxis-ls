"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./vacancy.controller");
const validator = require("./vacancy.validator");
module.exports = { basePath: "/vacancies", feature: "hr.recruitment", router: makeRouter({ controller, validator }) };
