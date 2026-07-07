"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./warehouse_location.controller");
const validator = require("./warehouse_location.validator");
module.exports = { basePath: "/locations", feature: "wms", router: makeRouter({ controller, validator }) };
