"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./leave_allowance.controller");
const validator = require("./leave_allowance.validator");
module.exports = { basePath: "/leave", feature: null, router: makeRouter({ controller, validator }) };
