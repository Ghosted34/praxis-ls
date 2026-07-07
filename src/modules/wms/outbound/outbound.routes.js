"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./outbound.controller");
const validator = require("./outbound.validator");
module.exports = { basePath: "/outbound", feature: "wms.inventory", router: makeRouter({ controller, validator }) };
