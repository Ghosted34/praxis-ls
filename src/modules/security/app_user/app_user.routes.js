"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./app_user.controller");
const validator = require("./app_user.validator");
module.exports = { basePath: "/users", feature: null, router: makeRouter({ controller, validator }) };
