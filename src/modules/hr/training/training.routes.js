"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./training.controller");
const validator = require("./training.validator");
module.exports = { basePath: "/trainings", feature: "hr.training", router: makeRouter({ controller, validator }) };
