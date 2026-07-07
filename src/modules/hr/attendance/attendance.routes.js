"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./attendance.controller");
const validator = require("./attendance.validator");
module.exports = { basePath: "/attendance", feature: null, router: makeRouter({ controller, validator }) };
