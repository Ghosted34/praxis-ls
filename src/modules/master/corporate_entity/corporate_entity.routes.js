"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./corporate_entity.controller");
const validator = require("./corporate_entity.validator");
module.exports = { basePath: "/entities", feature: null, router: makeRouter({ controller, validator }) };
