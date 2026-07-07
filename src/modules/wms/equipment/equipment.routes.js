"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./equipment.controller");
const validator = require("./equipment.validator");
module.exports = { basePath: "/equipment", feature: "wms", router: makeRouter({ controller, validator }) };
