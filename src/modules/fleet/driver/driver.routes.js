"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./driver.controller");
const validator = require("./driver.validator");
module.exports = { basePath: "/drivers", feature: "fleet", router: makeRouter({ controller, validator }) };
