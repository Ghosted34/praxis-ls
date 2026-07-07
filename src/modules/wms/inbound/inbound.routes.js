"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./inbound.controller");
const validator = require("./inbound.validator");
module.exports = { basePath: "/inbound", feature: "wms", router: makeRouter({ controller, validator }) };
