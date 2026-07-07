"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./appraisal.controller");
const validator = require("./appraisal.validator");
module.exports = { basePath: "/appraisals", feature: "hr.appraisals", router: makeRouter({ controller, validator }) };
