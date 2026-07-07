"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./inventory.controller");
const validator = require("./inventory.validator");
module.exports = { basePath: "/inventory", feature: "wms.inventory", router: makeRouter({ controller, validator }) };
